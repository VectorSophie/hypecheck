# Architecture

This document is for developers working on the Hypecheck codebase itself — not
end users running `hypecheck eval`. It walks the pipeline modules in call
order, then drills into four subsystems (discovery bounds, hook capability
model, token-economics evidence tiers, the local audit adapter) and two
subsystems added in this phase (provenance/confidence, redundancy semantics)
that are easy to misread from the outside because their behavior lives in a
handful of small, dense functions.

For the canonical, terse module list see CLAUDE.md's "Pipeline architecture"
section — this document doesn't restate it wholesale, it expands on the parts
that need more than one line to explain correctly.

## 1. Pipeline overview

`evaluateCandidate` (`src/evaluate.js`) runs nine stages in a fixed order, and
each stage only ever consumes what the previous ones produced — there's no
back-channel. `candidate.js` turns raw user input into a typed, side-effect-free
`{ type, canonical, subpath? }` struct. `fetchers.js` is the single point of
network I/O and, for GitHub candidates, delegates repo traversal to
`discovery.js` rather than probing a fixed set of root-level files, so a
monorepo or plugin marketplace with several components is walked once and
split into a `components[]` array. `hook-analysis.js` is a shared service
consumed by two different stages — `discovery.js` (deciding which hook
scripts are worth fetching) and `analyze.js` (turning a hook's capabilities
into a finding) — rather than a fetch-adjacent or analysis-adjacent-only
helper. `extractors.js` and `token-economics.js` both derive read-only signals
from whatever `fetchers.js`/`discovery.js` already pulled down (package
manifest fields; an evidence-tiered read on token/context-savings claims)
without themselves doing I/O or emitting scoring input directly.
`analyze.js` is the only place raw signals become `findings[]`, and everything
after it — `score.js`'s per-dimension scores and verdict, `report.js`'s
rendering — is a pure function of that array (plus a couple of parallel
metadata fields like `tokenEconomics` and `labels`). This "findings are the
only channel to the verdict" property is deliberate and enforced by
convention (see CLAUDE.md's "Conventions that matter"), not by a type system.

## 2. Discovery bounds

`src/discovery.js` defines two constant objects that bound how much of a
candidate repo it will ever look at:

```js
export const BOUNDS = {
  maxDepth: 6,
  maxEntries: 500,
  maxFiles: 40,
  maxBytes: 300_000,
  maxRequests: 60,
};

const HOOK_SCRIPT_BOUNDS = { maxScripts: 20, maxBytes: 100_000 };
```

`BOUNDS` governs the manifest/skill/command discovery pass (`discoverTree` +
`fetchInterestingFiles`):

- **`maxDepth` (6)** — caps how many path segments deep the walk will
  recurse. Guards against pathological directory nesting (accidental or
  adversarial) turning a bounded walk into an effectively unbounded one.
- **`maxEntries` (500)** — caps the total number of tree entries classified,
  independent of depth. A wide-but-shallow repo (thousands of files at one
  level) is just as much a cost concern as a deep one, so this is a separate
  counter from depth.
- **`maxFiles` (40)** and **`maxBytes` (300_000)** — both enforced in
  `fetchInterestingFiles`, which only fetches content for files `classifyPath`
  already flagged as interesting (manifests, hooks, skills, commands). These
  bound the *content-fetching* half of discovery separately from the
  *tree-walking* half: a repo could have thousands of matched paths but the
  actual `contents/` API calls (and the bytes downloaded) stay capped
  regardless.
- **`maxRequests` (60)** — bounds total GitHub API calls made during the
  bounded breadth-first walk (`walkShallow`, used for repos over the
  recursive-fetch size threshold). This is a distinct resource from bytes or
  files: each directory node costs one request even if it yields nothing
  useful, so without this cap a repo with many empty/irrelevant directories
  could exhaust rate limits without ever hitting the byte or file caps.

Together these bounds mean discovery has a knowable worst-case cost (in
requests, bytes, and wall-clock stops at fixed points) regardless of how large
or adversarially structured the target repo is — a single misbehaving or
enormous repo can't turn `hypecheck eval` into a runaway fetch loop.

There are two traversal strategies, chosen by `RECURSIVE_SIZE_THRESHOLD_KB =
5000`: repos at or under 5MB use one recursive git-trees API call (cheap,
`maxDepth`/`maxEntries` are applied to the returned list locally); larger
repos fall back to `walkShallow`'s directory-by-directory breadth-first walk,
where `maxRequests` and `maxDepth` are checked per queued node before it's
fetched.

`HOOK_SCRIPT_BOUNDS` (`maxScripts: 20`, `maxBytes: 100_000`) governs the
second, independent fetch pass in `fetchHookScripts` — resolving and fetching
the actual script a hook `command` points to, per component. It's kept
separate from `BOUNDS` because it runs later (only after components already
exist) and serves a different purpose: it's "best-effort security-analysis
aid," not discovery completeness — per the comment directly above the
function, a script that can't be fetched just degrades `classifyHook` to
command-line-only inference, never a crash or a false "safe" conclusion.

## 3. Hook capability model

`src/hook-analysis.js` builds one **capability struct** per hook by combining
two independent pieces: what script the hook's command points to, and what
that source (or, failing that, the command line itself) reveals.

`detectCapabilities(text)` runs a fixed set of conservative regexes over
whatever text it's given and returns a flags object — one boolean per
pattern (`execsShell`, `network`, `credentialAccess`, `destructive`,
`pipesDownloadToShell`, `gitMutation`, `deployMutation`, `autoAllows`,
`canBlock`, `readsStdinOrToolInput`, `mutatesToolInput`,
`returnsPermissionDecision`, `filesystemRead`, `filesystemWrite`) plus one
three-valued field, `failOpen` (`'open'` | `'closed'` | `'unknown'`), derived
from whether the source swallows exceptions without a non-zero exit. The
module docstring is explicit that this is false-negative-biased by design —
"not a malware scanner," it surfaces only what's structurally evident in the
text it's handed.

`resolveLocalScriptPath(command, componentRoot)` heuristically extracts a
repo-relative script path from a hook's `command` string (skipping
interpreter tokens like `node`/`python`, env-var-assignment prefixes, and
flags), resolved against the owning component's root so a hook declared
inside `plugins/shunt/hooks/hooks.json` referencing `route.js` resolves to
`plugins/shunt/route.js`. It returns `null` for anything that clearly isn't a
local bundled script — a remote URL, an absolute/home path, or a bare
external command — in which case the caller falls back to inferring from the
command line alone. Its own comment flags a known limitation: only the first
resolvable script in a chained command (`node a.js && node b.js`) is
returned.

`classifyHook(hookEntry, componentRoot, hookScripts)` ties these together
into the capability struct: it resolves the script path, checks whether that
path's source was actually fetched into `hookScripts` (populated by
`discovery.js`'s `fetchHookScripts`), and runs `detectCapabilities` against
the real source when available or the raw command string otherwise. The
struct carries `sourceInspected` (boolean) and `provenance` (`'source'` when
real script text was analyzed, `'inferred'` when only the command line was)
alongside the capability flags and bookkeeping fields (`event`, `matcher`,
`command`, `target`: `'bundled-script'` | `'opaque-command'` | `'unknown'`).

`src/analyze.js`'s `hookFinding(capability)` is the sole consumer that turns
this struct into a finding, and it enforces a strict priority order —
**dangerous > permission-bypass > unverified > benign** — producing exactly
one finding per hook:

1. **`hook-dangerous-capability`** (high) — fires if any of
   `execsShell`/`network`/`credentialAccess`/`destructive`/`pipesDownloadToShell`/`gitMutation`/`deployMutation`
   is true, regardless of `sourceInspected`. Filesystem read/write are
   deliberately excluded from this gate (per the comment in `hookFinding`) —
   writing a log/cache file is common and the static regexes can't tell a
   fixed path from an attacker-influenced one, so those two flags stay
   descriptive metadata only.
2. **`hook-permission-bypass`** (high) — fires if `autoAllows` is true (the
   hook returns `permissionDecision: "allow"`), independent of the dangerous
   set above.
3. **`hook-unverified-powerful`** (medium) — fires only when source
   *wasn't* inspected and the hook's event is in `HIGH_RISK_HOOK_EVENTS`
   (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`).
   This is explicitly the fix for a blunter "high-risk event ⇒ high
   severity" rule: an uninspected, otherwise-unremarkable command on a
   risky event is downgraded to medium rather than automatically treated as
   dangerous.
4. **`hook-benign-bounded`** (low) — the fallback when none of the above
   match; its title/evidence text distinguishes "inspected and shows nothing"
   from "not inspected, no pattern visible in the command" so a low-severity
   finding still communicates how much was actually verified.

The finding's own `provenance` field is set from `capability.sourceInspected`
too: `'source'` when real script text drove the classification, `'manifest'`
otherwise (since the hook entry itself still came from a parsed
`hooks.json`) — this feeds directly into `score.js`'s confidence calculation
(section 6 below).

## 4. Token economics evidence tiers

`src/token-economics.js` never lets a README sentence become a numeric score
by itself. `computeTokenEconomics(data, discovery)` combines three
independently-testable signal detectors into one evidence tier, ranked from
most to least trustworthy:

- **`benchmarked`** — `detectBenchmarkEvidence` checks whether any path in
  discovery's already-collected `scanned`/`skipped` lists matches
  `BENCHMARK_DIR` (`bench|benchmarks?|evals?|evaluations?` as a path
  segment). This is presence-only — it doesn't read benchmark *results*,
  just proves a checked-in benchmark harness exists somewhere discovery
  already looked at. No new network fetch is needed since it reuses
  discovery's output.
- **`observed-from-repo`** — `detectMechanismKeywords` finds a keyword from
  one of the `MECHANISM_FAMILIES` (`cheap-model-delegation`,
  `subagent-isolation`, `caching`, `deferred-loading`, `compression`,
  `retrieval`, `filtering`) inside `sourceText` — text joined from
  `data.hookScripts`, i.e. hook script content Phase 2's discovery actually
  fetched. Ranked above README mentions specifically because it comes from
  real fetched source, not prose.
- **`inferred`** — the same keyword-family detector run against
  `readmeText` (`data.readme` or `data.html`) instead of fetched source.
- **`claimed`** — `extractClaimedSavings` finds a bare percentage claim
  (e.g. "reduces tokens by 40%") via `SAVINGS_PATTERN`, with no supporting
  mechanism keyword or benchmark evidence at all.
- **`unknown`** — none of the above matched anything.

The tiers are checked in that order (`if (benchmark.present) ... else if
(sourceMechanisms.size > 0) ... else if (readmeMechanisms.size > 0) ... else
if (claim) ...`), so a repo with both a benchmark directory and a bare
percentage claim is tagged `benchmarked`, not `claimed`. The function then
derives two purely informational labels — `TOKEN_WIN` for
`benchmarked`/`observed-from-repo`, `TOKEN_UNPROVEN` for
`claimed`/`inferred` — and returns them alongside the raw claim, the
mechanism sets (`fromSource`/`fromReadme`), and the benchmark detail. As the
module docstring states, this whole subsystem produces informational labels
only; `score.js` never reads `tokenEconomics` and no finding is generated
from it.

## 5. Local audit adapter

`hypecheck audit` is a different mode from `hypecheck eval`: instead of
evaluating a candidate, it inspects the user's own local Claude Code setup.
It's worth understanding as a separate subsystem because it has its own
two-source data model and its own safety constraints, distinct from the
candidate-evaluation pipeline described above.

Two independent sources feed it. `local-context.js`/`audit.js` (unchanged
since Phase 1) are fast and synchronous — they read `.claude/settings.json`,
`.mcp.json`, and command/skill directories straight off disk, no subprocess
involved. `claude-cli.js`/`claude-audit-collector.js`/`audit-analyze.js`
(added in Phase 4) are async and talk to the real `claude` CLI (`--version`,
`plugin list --json`, `plugin details <id>`) through a `shell:false`,
timeout-bounded subprocess wrapper. That wrapper deliberately never calls
`claude mcp list`/`get` — those commands can reach out to configured MCP
servers, which is out of scope until a future opt-in `--probe` mode exists.
For a developer reading this code, the reason to keep these two sources
architecturally separate (rather than merging them into one collector) is
that they have very different risk profiles: one is pure file I/O with no
external process, the other spawns `claude` itself and must be defended
against hanging or leaking secrets through its output.

That defense is `redact.js`: `collectClaudeAudit()` (the single entry point
in `claude-audit-collector.js`) always routes its result through `redact()`
before anything else touches it, and `redactText()` is available separately
for scrubbing secret-shaped substrings — including full PEM key blocks, not
just their header line — out of raw string blobs like subprocess stderr.

`audit-analyze.js` turns the collected state into findings along three axes:
adversarial nested `CLAUDE.md` files (`detectInstructionBombs`, which shares
its keyword list, `ADVERSARIAL_DIR_KEYWORDS`, with `discovery.js`'s
candidate-side check so the two "does this path look like a deliberately
adversarial test fixture" heuristics can't silently drift apart), stale
project-specific references surviving in global config
(`detectStaleGlobalContext`), and plugin/MCP inventory — where large
projected-token plugins and effort/model fields are reported as budget
context, explicitly never as a vulnerability finding.

`audit --snapshot <name>`/`audit --diff <name>` (`audit-snapshot.js`, using
the same home-relative `~/.hypecheck/...` persistence convention as
`cache.js`) let a user capture a before/after pair around manually installing
a candidate — the closest thing this codebase has to a measurable `TRIAL`
verdict. Snapshot names are allowlisted to `[A-Za-z0-9_-]+` since they
originate from user-controlled CLI input and get interpolated into a
filesystem path.

Deliberately deferred gaps: no `--probe` mode (so `claude mcp list`/`get`
stay uncalled even opt-in, for now), no `.hypecheck/policy.json` preference
file, no Windows-native-vs-MSYS executable path compatibility findings.
`test/reference/claude-audit.sh` is the original shell-script design oracle
this adapter reimplements from — it documents intended behavior but is never
executed by this codebase or CI.

## 6. Provenance and confidence

This is Phase 5's own addition, and the most recently built subsystem in the
codebase — every finding now carries a `provenance` field, and `score.js`
uses it to compute a `confidence` value alongside (not blended into) the
verdict.

Reading through `src/analyze.js`, the provenance values assigned at each
finding site are:

- **`'package-metadata'`** — `missing-license`, `stale-maintenance`: derived
  from registry/GitHub metadata fields, not parsed manifest content.
- **`'manifest'`** — `npm-lifecycle-script`, `shell-execution-dependency`
  (from `analyzePackageSignals`, parsing actual `package.json` fields),
  `mcp-servers` (from a parsed MCP manifest), and hook findings where
  `capability.sourceInspected` is false (the hook entry itself still came
  from a parsed `hooks.json`, even though the script body wasn't fetched).
- **`'source'`** — hook findings where `capability.sourceInspected` is true:
  the bundled script's actual text was fetched and analyzed, not just its
  declared command.
- **`'inferred'`** — `candidate-instruction-bomb`. The comment directly
  above `analyzeInstructionBombs` explains why this is `'inferred'` rather
  than `'manifest'` even though it comes from `discovery.js`'s
  classification step: it's a file *path* matched against a naming pattern,
  not a parsed manifest's content, and mislabeling it `'manifest'` would let
  the confidence calculation treat a directory-naming coincidence as
  equivalent to real parsed config — which matters because this finding can
  independently push a repo into `DANGEROUS` when duplicated across
  multiple fixture paths.
- **`'readme'`** — all of `analyzeText`'s findings (`secret-reference`,
  `shell-capability-mentioned`, `prompt-injection-pattern`,
  `dangerous-hook-event`, `agent-tooling-scope`): pattern matches against
  README/HTML prose, the weakest evidence tier.
- **`'local-config'`** — the redundancy findings (`redundant-installed`,
  `redundant-capability`, `redundant-adjacent`) and the collision findings
  (`hook-event-collision`, `mcp-name-collision`, `command-name-collision`):
  these describe the *user's own* local setup, not anything fetched from the
  candidate, so they get a distinct label rather than being folded into
  `'manifest'`.

`src/score.js`'s `computeConfidence(findings)` reduces all of this to a
three-valued result:

```js
function computeConfidence(findings) {
  const hasDirectEvidence = findings.some((f) => f.provenance === 'manifest' || f.provenance === 'source');
  if (hasDirectEvidence) return 'high';
  return findings.length >= 3 ? 'medium' : 'low';
}
```

Any finding with `'manifest'` or `'source'` provenance earns `'high'`
confidence outright, on the reasoning (per the comment above the function)
that one piece of directly-inspected ground truth outweighs a pile of README
pattern-matches. With no such evidence, it falls back to the pre-Phase-5
heuristic of raw finding count (`>= 3` → `'medium'`, else `'low'`).

The comment block labeled `KNOWN LIMITATION` directly above `computeConfidence`
is explicit that this is a first-pass, binary rule: it isn't weighted by
finding count or severity, so a single low-severity `mcp-servers` declaration
earns the same `'high'` confidence as five high-severity manifest findings —
"confidence" here means "at least one piece of real evidence exists," not
"there's a lot of it" or "it's alarming." The same comment notes that
confidence and verdict are computed independently and can disagree — e.g. a
`DANGEROUS` verdict with `confidence: 'low'` when two `'inferred'`-provenance
`candidate-instruction-bomb` findings alone are what triggered it. It flags
this as worth revisiting only if report rendering ever presents "Confidence:
high" in a way a user could mistake for "thoroughly vetted."

## 7. Redundancy semantics

Also new in this phase: `src/capabilities.js` gained a second, richer
classifier alongside the pre-existing `matchStrength`, and the two are
explicitly additive rather than one replacing the other.

The underlying data is the same in both: `tagCapabilities(text)` matches free
text against `FAMILIES`, a hand-curated keyword map (`code-review`,
`linting`, `testing`, `browser`, `search`, `git`, `database`, `deployment`,
`lsp`, `memory-retrieval`, `cloud-provider`, and about a dozen more), each
family a list of keyword/phrase substrings. `GROUPS` rolls a few of those
families into a broader bucket (currently just `code-quality` ← `code-review`
+ `linting` + `formatting`), reflected in `FAMILY_TO_GROUP`.

**`matchStrength(aTags, bTags)`** is the pre-existing classifier that
`analyze.js`'s `analyzeRedundancy` uses to decide which finding to emit for
each locally-installed tool: `'strong'` if the two tag sets share any exact
family, `'weak'` if they don't share a family but do share a `GROUPS`
rollup, `'none'` otherwise. This directly drives `redundant-capability`
(strong) vs. `redundant-adjacent` (weak) findings, which in turn feed
`score.js`'s `redundancy` score and the `REDUNDANT` verdict threshold.

**`classifyOverlap(aTags, bTags)`** is the new function this phase adds. It
answers a related but distinct question — not "should this drive a finding"
but "how would a developer describe this pairing" — and returns one of five
labels: `'exact-duplicate'` (the two tag sets are identical), `'strong-overlap'`
(they share at least one family, but aren't identical), `'adjacent'` (no
shared family, but a pair in the small hardcoded `ADJACENCY` table connects
them — e.g. `lsp`/`semantic-code-nav`, `browser-automation`/`web-research`,
`git`/`git-github`), `'complementary'` (no overlap or adjacency, but a pair in
`COMPLEMENTARY` connects them — e.g. `planning`/`tdd`, `debugging`/`code-review`,
`deployment`/`security-scanning` — families that *commonly pair on purpose*
and should never read as redundant), or `'none'`.

The two classifiers are deliberately kept separate rather than merged: per
the comment directly above `classifyOverlap`, it "feed[s] NEW secondary
labels only, not a replacement" for `matchStrength`. In `analyzeRedundancy`,
`classifyOverlap` runs for *every* local tool — including the exact-name
match case that already produces a `redundant-installed` finding — purely to
populate the `overlapLabels` set (`EXACT_DUPLICATE` for
`'exact-duplicate'`, `CAPABILITY_OVERLAP` for `'strong-overlap'` or
`'adjacent'`); `'complementary'` and `'none'` add no label. Those labels flow
into `analyzeCandidate`'s combined `labels` array alongside the token-economics
and hook labels, but — like the token-economics labels — never reach
`score.js`'s dimension scores or `chooseVerdict`. `matchStrength`'s output,
by contrast, is what actually gates the `redundant-capability`/`redundant-adjacent`
findings and therefore the verdict. So the same tag data is classified twice,
by two independently-testable functions, for two different downstream
purposes: one produces verdict-driving findings, the other produces
descriptive labels layered on top.
