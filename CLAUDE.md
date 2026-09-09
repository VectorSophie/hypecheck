# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hypecheck is a local-first CLI that evaluates a dev/agent tool candidate (GitHub repo, npm package, or X/Twitter link) and emits a blunt verdict (`INSTALL`, `TRIAL`, `SKIP`, `REDUNDANT`, `DANGEROUS`) with evidence. No hosted service. Node.js ESM, `>=20`, no runtime dependencies.

## Commands

```sh
node --test                      # run full test suite (built-in Node runner)
node --test test/score.test.js   # single file (none exists yet; pattern holds)
node bin/hypecheck.js eval <candidate> [--json]
```

Tests are co-located in `test/*.test.js` and inject a fake `fetchImpl` via the `options` arg — no network calls in tests, no mocking framework.

## Pipeline architecture

`evaluateCandidate` (src/evaluate.js) is the orchestrator; everything flows through it in order:

1. **candidate.js** — `normalizeCandidate(input)` → `{ type: 'github'|'npm'|'social', canonical, ... }`. Pure string parsing, no I/O. Throws on unsupported input. GitHub candidates may carry an optional `subpath` (from `owner/repo#plugins/shunt` or a `/tree/<ref>/...` URL) to address one component of a monorepo/marketplace directly.
2. **fetchers.js** — `fetchCandidateData(candidate, options)` hits GitHub API / npm registry / social HTML. The ONLY module that does network I/O. Takes `options.fetchImpl` (defaults to `globalThis.fetch`) — this is the test seam. GitHub candidates run bounded recursive discovery (`discovery.js`) instead of root-only manifest probes — see its module docstring for the bounds (depth/entries/files/bytes/requests).
3. **discovery.js** — `discoverComponents(fetchImpl, repoUrl, headers, {defaultBranch, repoSizeKb, subpath})` walks the repo's git tree (single recursive call for small repos, bounded breadth-first for large ones), classifies paths by name only, fetches content only for classified files, follows `.claude-plugin/marketplace.json` `source` entries (with a path-traversal guard), and groups results into `components[]`. A repo with 2+ components produces a rollup with one verdict per component instead of one blended verdict — see `evaluate.js`'s `evaluateMultiComponent`.
4. **hook-analysis.js** — `classifyHook(hookEntry, componentRoot, hookScripts)` combines `resolveLocalScriptPath` (heuristically finds a hook's bundled script from its command) and `detectCapabilities` (conservative regex-based capability detection — shell exec, network, credential access, permission auto-allow/deny, destructive commands, etc.) into a capability struct with a `sourceInspected`/`provenance` flag. Used by `discovery.js` (to decide which scripts to fetch) and `analyze.js` (to turn hooks into capability-aware findings instead of a blanket "high-risk event ⇒ high severity" rule).
5. **extractors.js** — pulls package signals (lifecycle scripts, deps) and social links out of fetched data.
6. **token-economics.js** — `computeTokenEconomics(data, discovery)` produces an evidence-tiered read on any token/context-savings claim: `benchmarked` (a bench/eval directory exists) > `observed-from-repo` (a mechanism keyword found in real fetched hook source) > `inferred` (mechanism keyword only in README prose) > `claimed` (a bare percentage claim, no supporting evidence) > `unknown`. Never turns a README sentence directly into a score — produces informational `TOKEN_WIN`/`TOKEN_UNPROVEN` labels only, `score.js` is untouched.
7. **analyze.js** — `analyzeCandidate(data)` produces a flat `findings[]` array plus `tokenEconomics`/`labels`. Each finding: `{ id, severity: low|medium|high, category: security|maintenance|workflow, title, evidence }`. This is the only place heuristics live. Hook findings are capability-aware (`hook-dangerous-capability`, `hook-permission-bypass`, `hook-unverified-powerful`, `hook-benign-bounded` — see `hook-analysis.js`), not derived from the hook's event name alone.
8. **score.js** — `scoreAnalysis(analysis)` turns findings into 0–10 scores per dimension + the overkill index, then `chooseVerdict` maps scores→verdict.
9. **report.js** — `renderMarkdownReport(report)` for human output; `--json` bypasses it and dumps the report object.

`social` candidates short-circuit: fetch HTML → extract first GitHub/npm link → recurse into `evaluateCandidate`.

## Conventions that matter

- **Findings drive everything downstream.** To change a verdict, add/adjust a finding in analyze.js, then check `SEVERITY_WEIGHT` and `chooseVerdict` thresholds in score.js — don't special-case verdicts elsewhere.
- **Time is injectable.** Staleness checks read `options.now` (defaults to `new Date()`); tests pass a fixed date.
- **Exit codes are contract** (bin/hypecheck.js): `0` INSTALL/TRIAL, `1` SKIP/REDUNDANT/DANGEROUS, `2` bad input, `3` fetch/eval failure. `runCli` is exported and takes injectable `stdout`/`stderr`.
- The `claude-plugin/` slash command just shells out to `npx @jackochesstern/hypecheck eval` — it intentionally adds no hooks or background behavior.

## Packaging

- `claude-plugin/.claude-plugin/plugin.json` is the plugin manifest; `claude-plugin/commands/hypecheck.md` is auto-discovered as `/hypecheck`.
- Repo-root `.claude-plugin/marketplace.json` lists the plugin (`source: ./claude-plugin`) so the marketplace installs straight from the GitHub repo.
- `package.json` `files` ships only `bin/` and `src/` to npm.
