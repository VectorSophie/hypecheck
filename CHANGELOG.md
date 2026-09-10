# Changelog

All notable changes to Hypecheck are documented in this file. Versions follow
the tags on this repository; entries are grouped newest first.

## v0.5.0

The largest release since v0.1.0, split across five phases: recursive
repo discovery, capability-aware hook risk, token/context-economics
evidence tiers, a native local-audit adapter, and a pass over redundancy
semantics and reporting.

- **Recursive discovery (Phase 1).** Replaced root-only manifest probing
  with a bounded, breadth-first/recursive walk of a GitHub repo's git tree
  (`discovery.js`), so components nested in subdirectories are found
  instead of missed. Adds subpath addressing (`owner/repo#plugins/shunt`
  or a `/tree/<ref>/...` URL) so a single component of a monorepo or
  marketplace can be evaluated directly. Repos whose
  `.claude-plugin/marketplace.json` lists multiple `source` entries are
  now evaluated as a **rollup** — one verdict per component instead of a
  single blended verdict — with a path-traversal guard on marketplace
  source paths and hardening against backslash/drive-letter/UNC traversal.
- **Capability-aware hook risk (Phase 2).** Hook findings no longer come
  from a blanket "high-risk event ⇒ high severity" rule. `hook-analysis.js`
  resolves a hook's bundled script from its command, fetches it (bounded),
  and runs conservative regex-based capability detection (shell exec,
  network access, credential access, permission auto-allow/deny,
  destructive commands) to produce capability-specific findings
  (`hook-dangerous-capability`, `hook-permission-bypass`,
  `hook-unverified-powerful`, `hook-benign-bounded`) with a
  `sourceInspected`/provenance flag noting whether the actual script was
  read or the classification is a guess.
- **Token/context economics (Phase 3).** `token-economics.js` adds an
  evidence-tiered read on any token- or context-savings claim a candidate
  makes: `benchmarked` (a bench/eval directory exists) >
  `observed-from-repo` (mechanism keyword found in real fetched hook
  source) > `inferred` (mechanism keyword only in README prose) >
  `claimed` (a bare percentage claim, no evidence) > `unknown`. Surfaces
  as informational `TOKEN_WIN`/`TOKEN_UNPROVEN` labels; never feeds the
  score directly.
- **Native local-audit adapter (Phase 4).** `hypecheck audit` now has a
  second, async data source alongside the existing file-based scan:
  `claude-cli.js`/`claude-audit-collector.js` shell out to the real
  `claude` CLI (`--version`, `plugin list --json`, `plugin details <id>`)
  through a `shell:false`, timeout-bounded wrapper, deliberately never
  calling `claude mcp list`/`get`. Everything collected is passed through
  `redact.js` before use. `audit-analyze.js` turns the result into
  findings — adversarial nested `CLAUDE.md` instruction bombs, stale
  project-specific references in global config, plugin/MCP inventory. New
  `audit --snapshot <name>` / `audit --diff <name>` flags let a user
  capture a before/after pair around installing a candidate.
- **Redundancy semantics, labels, and reporting (Phase 5).** Expanded the
  capability family model with an adjacency/complementary-overlap
  classifier so overlapping tools are distinguished from exact
  duplicates; added candidate-side instruction-bomb detection (mirroring
  the audit adapter's own check); attached provenance to every finding
  and folded it into a provenance-weighted confidence figure; added
  secondary labels (`EXACT_DUPLICATE`, `CAPABILITY_OVERLAP`,
  `POWERFUL_HOOK`, `HOOK_PERMISSION_BYPASS`, `GLOBAL_SCOPE_OVERKILL`);
  added a "Privileged behavior" section to the markdown report and a
  labels row to the `compare` output.

## v0.4.0

- Added a stack-fit profile: Hypecheck derives the user's own stack from
  local project context and notes whether a candidate actually fits it,
  rather than scoring every candidate in isolation.

## v0.3.0

- Added the `audit` command for inspecting a user's own local Claude Code
  setup (file-based scan of `.claude/settings.json`, `.mcp.json`, command
  and skill directories).
- Added command-name collision detection and maintainer-change drift
  tracking.
- Added a net-new fit line to the report for candidates that don't
  overlap with anything already installed.

## v0.2.0

- Added the `compare` and `explain` commands.
- Added workflow-collision detection — flags a candidate that duplicates
  something the user already has installed.
- Added opt-in drift tracking (`--track`) for watching a candidate's
  manifest for changes over time.

## v0.1.1

- Parses real hook, MCP, and plugin manifests instead of relying on
  README heuristics alone, and recalibrated those heuristics against the
  new manifest signal.
- Added `.env` auto-loading (for `GITHUB_TOKEN`, etc.).

## v0.1.0 (initial release)

The first working version of Hypecheck: a local-first CLI that fetches a
GitHub repo, npm package, or social link, scores it, and emits a blunt
verdict.

- Local context scan and real redundancy scoring against what the user
  already has installed.
- A findings-derived roast summary, with findings framed as caveats under
  positive verdicts rather than as the reason for the verdict itself.
- GitHub `package.json` parsing for parity with npm candidates, plus
  early prompt-injection and hook-event heuristics.
- Filtered out generic/noisy npm scripts from findings; added a GitHub
  `User-Agent` header and `GITHUB_TOKEN` support to avoid unauthenticated
  rate limits.
- Packaged for distribution: Claude Code plugin manifest and
  marketplace listing, npm packaging (`files` allowlist, `LICENSE`),
  and a friendly error message on GitHub API 403s.
- Published to npm as the scoped package `@jackochesstern/hypecheck`
  after a name collision with the unscoped name.
- Rewrote the README in a trending-plugin style with logo/banner
  branding.
