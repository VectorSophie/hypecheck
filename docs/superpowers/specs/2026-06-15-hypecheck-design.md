# Hypecheck Product Design

## Summary

Hypecheck is a Claude Code plugin backed by a local CLI engine. It evaluates GitHub repositories, npm packages, and messy links copied from X/Twitter before a user installs another Claude Code plugin, MCP server, hook, slash command, skill, agent workflow, or adjacent dev tool.

The product promise:

> Before installing another agent/dev tool, run it through Hypecheck.

The tone is a blunt bullshit detector on top of serious security-audit evidence. The verdict should be memorable; the analysis should be sober enough that a security-minded developer can verify it.

## Primary User Moment

A Claude Code user sees a tool linked from GitHub, npm, a README, or a social post and wonders:

> Should I install this thing, or is it redundant, unsafe, overkill, or budget-hostile?

They run:

```text
/hypecheck https://github.com/example/suspicious-mcp
/hypecheck @scope/npm-package
/hypecheck https://x.com/someone/status/...
```

Hypecheck fetches public metadata and relevant source files, scans local Claude Code context where safe, and returns a report inside Claude Code.

## Product Position

Hypecheck is not a generic vulnerability scanner and not a hosted marketplace. It is a local pre-install judgment layer for agentic development tools.

Primary scope:

- Claude Code plugins
- MCP servers
- hooks
- slash commands and skills
- subagents and agent workflows
- local tools that affect Claude Code behavior

Secondary scope:

- npm packages likely to affect dev-agent workflows
- linters, test runners, browser automation, GitHub bots, code review bots, security scanners
- general dev tools when the install path creates agent permissions, shell execution, dependency risk, or context/budget pressure

Out of scope for v1:

- hosted dashboard
- marketplace hosting
- private repo analysis unless the user explicitly provides a local path or authenticated fetch later
- exact Claude subscription billing calculations
- automatic install or uninstall actions
- scraping Claude account pages or session cookies

## Research And Prior Art

### Claude Code Surfaces

Claude Code settings are intentionally spread across user, project, local, and managed scopes. Official docs identify settings in `~/.claude/settings.json`, project settings in `.claude/settings.json`, local settings in `.claude/settings.local.json`, MCP configuration in `~/.claude.json` and `.mcp.json`, project and user `CLAUDE.md`, subagents under `.claude/agents/` and `~/.claude/agents/`, and plugin settings through `enabledPlugins` and marketplaces. See the [Claude Code settings docs](https://code.claude.com/docs/en/settings).

Claude Code plugins can bundle skills, agents, hooks, and MCP servers, and are distributed through marketplaces. Plugin settings include `enabledPlugins`, `extraKnownMarketplaces`, `strictKnownMarketplaces`, and related policy controls. See [plugin configuration in Claude Code settings](https://code.claude.com/docs/en/settings).

MCP servers give Claude Code access to external tools, databases, and APIs, and Anthropic explicitly warns users to verify trust before connecting servers that fetch external content because of prompt-injection risk. See [Claude Code MCP docs](https://code.claude.com/docs/en/mcp).

Hooks are especially sensitive. Anthropic documents that command hooks run shell commands with the user's full system permissions and can modify, delete, or access any files the user can access. See [Claude Code hooks security considerations](https://code.claude.com/docs/en/hooks).

Skills are a plausible packaging surface for Hypecheck's evaluation methodology, but official docs describe skills as instruction bundles invoked with slash commands, not as the best place for a fetch/scan/cache engine. See [Claude Code skills docs](https://code.claude.com/docs/en/slash-commands).

### Security And Agent Risk Landscape

MCP and agent tools have specific risks that normal package scanners do not fully capture:

- Tool poisoning, where malicious instructions are embedded in tool metadata.
- Prompt injection through external content fetched by an MCP server.
- Rug pulls, where tool descriptions or behavior change after approval.
- Shell, filesystem, network, and credential exposure through hooks or tool invocations.
- Cross-tool attacks where one benign-looking tool combines with another to exfiltrate data.

Recent MCP security research emphasizes these risks. The 2026 paper [Model Context Protocol Threat Modeling and Analyzing Vulnerabilities to Prompt Injection with Tool Poisoning](https://arxiv.org/abs/2603.22489) identifies tool poisoning as a major client-side vulnerability and recommends static metadata analysis, behavioral anomaly detection, and user transparency. [MCPTox](https://arxiv.org/abs/2508.14925) builds a benchmark around real-world MCP servers and tool poisoning. [MCP-in-SoS](https://arxiv.org/abs/2603.10194) proposes a risk-assessment framework for open-source MCP servers. [MCP Safety Audit](https://arxiv.org/abs/2504.03767) introduces MCPSafetyScanner, an agentic MCP safety auditing tool.

### Related Tools

OpenSSF Scorecard provides automated open-source security health metrics. It is useful prior art for maintenance and supply-chain heuristics, but it is broad OSS infrastructure rather than an agent-tool install decision product. Its own docs warn that its checks are heuristic and not a definitive one-size-fits-all report. See [OpenSSF Scorecard](https://github.com/ossf/scorecard).

`npm audit` checks known vulnerabilities in a project's dependency tree and can verify registry signatures/provenance. It does not answer whether a new agent tool is redundant, overkill, or dangerous in the context of Claude Code permissions. See [npm audit docs](https://docs.npmjs.com/cli/v10/commands/npm-audit/).

Socket, Snyk, Grype, and related supply-chain tools help with dependency risk, vulnerability scanning, and package health. Hypecheck should not compete head-on with them. It should integrate the same style of signals where possible, then add agent-specific judgment.

MCPSafetyScanner is closest on MCP security auditing, but Hypecheck differs by targeting the pre-install user moment, supporting npm/GitHub/social links, considering local Claude Code context, scoring redundancy and budget/context pressure, and shipping as a Claude Code plugin rather than a standalone research scanner.

## Recommended Approach

Build Hypecheck as:

1. A Claude Code plugin as the user-facing product.
2. A local TypeScript CLI core as the reusable engine.
3. Optional MCP server support later, not required for v1.
4. No hosted backend.

This lets users run Hypecheck exactly where the decision happens while keeping the actual fetch/scan/report engine testable and reusable outside Claude Code.

## Why Not MCP First

MCP is useful when Claude needs structured tools available throughout a workflow, but Hypecheck's core user action is a pre-install command. A plugin with a slash command is simpler, more memorable, and easier to install.

MCP can become a v1.5/v2 surface:

- `evaluate_candidate`
- `scan_current_setup`
- `compare_candidates`
- `audit_hook_safety`
- `estimate_budget_fit`

For v1, MCP is optional because the slash command can call the CLI and return a Markdown report.

## V1 User Experience

### Commands

```text
/hypecheck <github-url | npm-package | npm-url | x-twitter-url>
/hypecheck --json <candidate>
/hypecheck explain <finding-id>
/hypecheck compare <candidate-a> <candidate-b>
```

The minimum useful v1 can ship with only:

```text
/hypecheck <candidate>
```

and a CLI equivalent:

```text
npx hypecheck eval <candidate>
```

### Candidate Normalization

Hypecheck accepts:

- `https://github.com/owner/repo`
- `github.com/owner/repo`
- `owner/repo` when unambiguous
- `npm:<package>`
- `<package>` or `@scope/package`
- `https://www.npmjs.com/package/<package>`
- X/Twitter links that contain or resolve to GitHub/npm links

For social links, v1 should extract visible GitHub/npm URLs from the page or fetched metadata. If extraction fails, it should ask the user to paste the actual candidate URL rather than attempting brittle account scraping.

### Output Format

Each report contains:

- Verdict: `INSTALL`, `TRIAL`, `SKIP`, `DANGEROUS`, or `REDUNDANT`
- One-line blunt summary
- Score table
- Evidence-backed findings
- Local context notes
- Recommended install mode
- Confidence level
- What Hypecheck could not verify

Example:

```text
Verdict: SKIP

This is a glorified shell wrapper wearing an agent costume.

Scores:
- Workflow Fit: 4/10
- Redundancy: 8/10
- Security Risk: 7/10
- Maintenance Health: 3/10
- Setup Burden: 6/10
- Budget/Context Pressure: 6/10
- Overkill Index: 79/100

Evidence:
- Declares a postinstall script.
- Configures a Claude Code hook that can run shell commands.
- Requests broad filesystem access through an MCP tool.
- No release tags; last commit 11 months ago.
- Duplicates your existing review and test hooks.

Recommendation:
Do not install globally. If you insist, test in a disposable project with secrets removed.
```

## Scoring Model

Hypecheck should avoid fake precision. Scores are explainable heuristics, not mathematically pure truth.

### Verdict Mapping

- `DANGEROUS`: high-risk behavior with weak trust signals or direct secret/filesystem/network danger.
- `SKIP`: poor fit, weak maintenance, high setup burden, or no clear value.
- `REDUNDANT`: overlaps heavily with existing local tools or Claude Code config.
- `TRIAL`: useful but risky or uncertain; install only project-local or in a sandbox.
- `INSTALL`: clear use case, acceptable risk, good maintenance, low redundancy.

### Dimensions

`Workflow Fit`
: Does this solve a real agent/dev workflow problem for the user?

`Redundancy`
: Does the user already have equivalent MCP servers, hooks, skills, CLI tools, npm scripts, or repo automation?

`Security Risk`
: Does it run shell commands, read secrets, request broad filesystem/network access, install scripts, spawn child processes, or expose external content to the model?

`Maintenance Health`
: Recent commits, releases, issue response, license, dependency freshness, maintainer identity, stars/downloads as weak supporting signals.

`Setup Burden`
: Number of steps, global install requirements, external accounts, credentials, config complexity, platform assumptions.

`Budget/Context Pressure`
: Likely tool-call volume, MCP tool count, large outputs, extra context injection, verbose hooks, subagent loops, or repeated background work.

`Overkill Index`
: Composite signal: high setup burden + high redundancy + low workflow fit + high context pressure.

## Data Sources

### Remote Public Sources

GitHub:

- repository metadata
- README
- license
- package manifests
- release tags
- commit recency
- open issue count and stale issue indicators
- workflow files
- installation instructions
- plugin manifests if present
- MCP server descriptors if discoverable

npm:

- package metadata
- versions
- dist tags
- publish recency
- dependencies
- install scripts
- bin entries
- repository link
- readme
- license
- unpacked package files via safe tarball inspection

X/Twitter:

- only used as a link extraction source
- no login, session scraping, or timeline scraping in v1
- if public page fetch fails, ask user for the underlying GitHub/npm URL

### Local Sources

Hypecheck may inspect:

- project `.claude/settings.json`
- project `.claude/settings.local.json`
- project `.mcp.json`
- project `CLAUDE.md`
- project `.claude/agents/`
- project `.claude/skills/`
- project package manifests and scripts
- user `~/.claude/settings.json`
- user `~/.claude/agents/`
- user `~/.claude/skills/`
- user `~/.claude.json`, but only non-secret MCP/config metadata

Hypecheck must avoid:

- reading secrets by default
- dumping prompt history
- reading unrelated shell history
- reading OAuth tokens or session cookies
- sending local configuration to a hosted service

When sensitive files are encountered, Hypecheck should record their presence as a risk boundary without exposing contents.

## Architecture

```text
hypecheck/
  packages/
    core/
      candidate-normalizer
      fetchers
      extractors
      local-context
      analyzers
      scorer
      report
    cli/
      hypecheck eval
      hypecheck compare
      hypecheck explain
    claude-plugin/
      plugin manifest
      slash command /hypecheck
      bundled skill/report instructions
```

### Core Package

Pure TypeScript engine. It accepts a candidate string and optional local context path, then returns structured JSON.

Responsibilities:

- normalize candidate inputs
- fetch public GitHub/npm metadata
- inspect safe files
- parse manifests
- collect findings
- score dimensions
- produce structured report data

### CLI Package

Thin wrapper around core.

Responsibilities:

- parse args
- print Markdown by default
- print JSON with `--json`
- cache fetched metadata
- provide deterministic exit codes

Exit codes:

- `0`: report generated, verdict is `INSTALL` or `TRIAL`
- `1`: report generated, verdict is `SKIP`, `REDUNDANT`, or `DANGEROUS`
- `2`: invalid input
- `3`: fetch failed
- `4`: local scan permission/config error

### Claude Code Plugin

The main user-facing install surface.

Responsibilities:

- expose `/hypecheck`
- call the local CLI core
- render the blunt report
- include a Hypecheck skill for interpreting findings and suggesting safer install modes
- avoid any always-on hook in v1

V1 should not install a Claude Code hook by default. A security tool that immediately adds background execution would be a deeply funny own goal, but still an own goal.

## Analysis Rules

### Security Findings

Flag high-risk patterns:

- `postinstall`, `preinstall`, `prepare`, or lifecycle scripts
- shell execution through `child_process`, `execa`, `shelljs`, `zx`, or equivalent
- broad filesystem reads/writes
- `.env`, `.ssh`, token, key, credential references
- network calls to unknown endpoints
- MCP tools with vague descriptions or hidden high-impact behavior
- hooks that execute commands on `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, or session lifecycle events
- tool descriptions that include model-facing instructions unrelated to the tool's purpose
- base64 or obfuscated command strings
- unpinned remote install commands
- global install requirements

### Redundancy Findings

Compare candidate capabilities against local context:

- installed MCP servers
- enabled plugins
- slash commands/skills
- hooks
- npm scripts
- common tools already present in `package.json`
- CI workflows
- repo docs and `CLAUDE.md` instructions

Example:

If a candidate advertises code review automation but local context already has Semgrep, GitHub CLI, a `/review` skill, and a post-edit test hook, mark high redundancy unless the candidate adds a distinct capability.

### Budget/Context Findings

Flag:

- many MCP tools
- verbose tool descriptions
- large prompt injections from skills or CLAUDE.md fragments
- background hooks that wake Claude or add context repeatedly
- workflows that spawn multiple subagents by default
- tools that fetch large external payloads into context

Hypecheck should use ranges and confidence, not exact billing claims.

## Privacy And Safety Principles

- Local-first by default.
- No Hypecheck backend in v1.
- Fetch only public candidate metadata/source.
- Never exfiltrate local Claude Code config.
- Do not read secret contents.
- Do not scrape Claude account pages.
- Do not use session cookies.
- Do not auto-install candidates.
- Show what was scanned and what was skipped.

## Trust Model

Hypecheck is advisory. It does not guarantee safety.

The report must make three things clear:

1. What evidence was directly observed.
2. What was inferred.
3. What could not be verified.

This matters because overconfident security theater is just hype wearing a badge.

## MVP

The MVP should support:

- `/hypecheck <candidate>` in Claude Code
- `npx hypecheck eval <candidate>`
- GitHub candidate fetch
- npm candidate fetch
- X/Twitter URL extraction for candidate links
- safe local Claude Code context scan
- security/risk findings
- redundancy findings
- maintenance findings
- setup burden findings
- Markdown and JSON reports

MVP can skip:

- MCP server surface
- hosted registry
- authenticated GitHub
- private repos
- exact subscription modeling
- dynamic sandbox execution
- browser UI
- team policy management

## Success Criteria

Hypecheck v1 succeeds if it can answer these questions reliably:

- What is this candidate?
- What would it add to my Claude Code/dev workflow?
- What local capabilities does it duplicate?
- What permissions or behaviors make it risky?
- Is it maintained enough to trust?
- Would it increase context/tool-call/budget pressure?
- Should I install it, trial it, skip it, or treat it as dangerous?

The product has found its wedge when users start pasting plugin links into Claude Code and expecting Hypecheck to roast them responsibly.

## Open Decisions

These can be deferred until implementation planning:

- Exact Claude Code plugin manifest format for the first packaged release.
- Whether npm package tarball inspection happens by default or behind a `--deep` flag.
- Whether GitHub API usage starts unauthenticated only or optionally supports `GITHUB_TOKEN`.
- Whether to call OpenSSF Scorecard API opportunistically or keep v1 self-contained.
- Whether to include a curated local rule pack in JSON/YAML or encode rules in TypeScript first.

## Recommendation

Build Approach 1:

> Claude Code plugin first, local TypeScript CLI core underneath, optional MCP later.

This preserves the best user moment, avoids server costs, keeps user data local, and creates a reusable core that can grow into other surfaces without a rewrite.
