# Hypecheck Slice 1: Local Context Scan + Redundancy

## Goal

Make the `Redundancy` dimension real. Today `score.js` hardcodes `redundancy: 1`
and `analyze.js` returns `unknowns: ['No local Claude Code context was scanned.']`.
This slice scans the user's local Claude Code / dev config, infers what the
candidate does, and emits redundancy findings that name the specific local tool
already covering that capability. This is the product's core wedge — the thing a
generic package scanner cannot do.

GitHub and npm are equal first-class targets. We fetch the GitHub `package.json`
along the way so GitHub candidates get capability inference at npm parity.

## Non-goals (this slice)

- Parsing the *behavior/contents* of local hooks or MCP tools for risk (Slice 3).
- Findings-derived roast text (Slice 2).
- Embeddings or a formal capability ontology.

## Redundancy model: keyword tags + light semantic grouping

`capabilities.js`:

```js
// family -> keywords
const FAMILIES = {
  'code-review': ['review', 'semgrep', 'codeql', 'pr review'],
  'linting':     ['lint', 'eslint', 'ruff'],
  'formatting':  ['format', 'prettier', 'style'],
  'testing':     ['test', 'jest', 'vitest', 'pytest', 'coverage'],
  'browser':     ['browser', 'playwright', 'puppeteer', 'screenshot'],
  'fetch':       ['fetch', 'http client', 'scrape', 'crawl'],
  'search':      ['search', 'ripgrep', 'grep', 'find files'],
  'git':         ['git ', 'commit', 'github cli', 'gh '],
  'database':    ['database', 'sql', 'postgres', 'sqlite'],
  'docs':        ['docs', 'documentation', 'readme generator'],
};
// families roll up into broader groups (the "hint of C")
const GROUPS = {
  'code-quality': ['code-review', 'linting', 'formatting'],
};
```

- `tagCapabilities(text)` -> `Set<family>`: lowercases text, matches keywords.
- Match strength between candidate tags and a local tool's tags:
  - **strong**: candidate's own name/package already installed locally, OR same family overlap.
  - **weak**: same *group*, different family (e.g. candidate is a linter, user has a formatter).

Source text for candidate tags: README + description + package name + (GitHub
`package.json` name/description). Source for a local tool's tags: its name +
any description/matcher string in config.

## Local context scan

`local-context.js`:

```js
scanLocalContext({ cwd, home, fs }) -> LocalTool[]
// LocalTool = { kind, name, tags }
// kind in { mcp, plugin, skill, command, hook, npm-script, dep }
```

Scanned sources (each missing file is silently skipped, never an error):

| Source | Path | Yields |
|---|---|---|
| project MCP | `<cwd>/.mcp.json` | mcp server names |
| project settings | `<cwd>/.claude/settings.json` + `.local.json` | enabled plugins, hook matchers |
| project commands/skills | `<cwd>/.claude/commands/*`, `.claude/skills/*` | command/skill names |
| project package | `<cwd>/package.json` | npm-script names, dep names |
| user MCP/config | `<home>/.claude.json` | mcp server names (non-secret keys only) |
| user settings | `<home>/.claude/settings.json` | enabled plugins, hooks |
| user commands/skills/agents | `<home>/.claude/{commands,skills,agents}/*` | names |

`cwd`, `home`, and `fs` are injectable (mirrors the existing `fetchImpl`
test-seam) so tests touch no real disk.

### Privacy

Read only enumerable names/ids/matchers. Never read env values, tokens, or
anything secret-shaped from `.claude.json` (skip the `env`/`headers` blocks of
MCP entries). Do not send local data anywhere — this stays in-process. Presence
of secret-bearing files is **not** inspected for content in this slice.

## Wiring & scoring

- `evaluate.js`: after `fetchCandidateData`, call `scanLocalContext` unless
  disabled; pass the result into `analyzeCandidate(data, { localTools, ... })`.
  GitHub fetch additionally pulls `package.json` (best-effort, like the README).
- `analyze.js`: add redundancy findings, category `redundancy`, each naming the
  matched local tool in `evidence` (e.g. ``Overlaps with your existing `/review`
  skill.``). Replace the stub `unknowns` with a real scanned-scope note, or an
  opt-out note when scanning is disabled.
- `score.js`:
  - `redundancy = clamp(1 + 3*strongOverlaps + 1*weakOverlaps, 1, 10)`
  - `chooseVerdict`: emit **REDUNDANT** when `redundancy >= 6` and no strong
    unique-value signal, ranked below DANGEROUS but above SKIP.

## CLI

- `--no-scan`: skip local scanning (redundancy stays at floor, note says so).
- `--scan <path>`: override `cwd` for the project scan.
- Exit codes unchanged; REDUNDANT remains a `1` exit (already in that set).

## Test plan (node:test, injected fs + fetchImpl)

- `capabilities.test.js`: keyword tagging; family vs group match strength.
- `local-context.test.js`: parse each source from injected fs; missing files
  skipped; secret blocks not read.
- `analyze.test.js` (extend): exact-name redundancy, family overlap, group
  overlap weak match, evidence names the local tool.
- `score.test.js` (new): redundancy scoring math; REDUNDANT verdict threshold.
- `cli.test.js` (extend): `--no-scan` and `--scan` behavior.
```
