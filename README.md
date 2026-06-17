<p align="center">
  <img src="https://raw.githubusercontent.com/VectorSophie/hypecheck/main/logo/hypecheck-banner.png" width="380" alt="Hypecheck">
</p>

<p align="center">
  <em>Before you install another agent tool, run it through Hypecheck.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/@jackochesstern/hypecheck?style=flat-square&color=111111&label=npm" alt="npm">
  <img src="https://img.shields.io/badge/node-%3E%3D20-111111?style=flat-square" alt="node >=20">
  <img src="https://img.shields.io/badge/runtime%20deps-0-111111?style=flat-square" alt="zero deps">
  <img src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" alt="MIT">
</p>

<p align="center">
  <strong>A blunt verdict backed by real evidence &middot; local-first &middot; no hosted service</strong>
</p>

---

Every week there's a new MCP server, plugin, hook, or skill that will "10x your agent." Some are great. Some are a `postinstall` script and a hook that runs shell commands with your full permissions. You can't tell from the README, and the README is the point.

Hypecheck reads the repo or package the way a paranoid senior dev would, and hands you one of five verdicts with the evidence stapled to it.

## What it looks like

It reads the repo's *actual* config — `hooks.json`, `.mcp.json`, `plugin.json`, `package.json` — not just the README. So the evidence points at what the tool really does:

```text
$ hypecheck eval https://github.com/some/vault-sync

Verdict: DANGEROUS

Dangerous. This touches sharp objects and acts casual about it:
Configures a PostToolUse hook running `[ -d .git ] || exit 0; ... git commit
-am ...`, which executes with full user permissions.

## Evidence
- [HIGH]   Configured Claude Code hook: a PostToolUse hook running git on every
           tool call, with full user permissions.
- [MEDIUM] Configured Claude Code hook: a SessionStart hook.
- [LOW]    Secret or credential access mentioned in README.
```

Exit code is `1`. Your CI can read that.

A tool that just *mentions* an API key isn't dangerous, and v0.1+ won't pretend it is:

```text
$ hypecheck eval https://github.com/some/channel-cli

Verdict: INSTALL

Install. The evidence does not scream at us yet.

## Evidence
- [LOW] Bundles MCP server(s): declares 2 MCP servers.
- [LOW] Secret or credential access mentioned in README.
```

## The five verdicts

| Verdict | Means |
|---|---|
| `INSTALL` | Clear use, acceptable risk, maintained, not redundant. |
| `TRIAL` | Useful but risky or uncertain — sandbox it, don't install globally. |
| `SKIP` | Weak fit, weak maintenance, or high setup burden for little payoff. |
| `REDUNDANT` | You already own this. It names the local tool it duplicates. |
| `DANGEROUS` | Touches secrets, shell, or hooks and acts casual about it. |

## What it checks

- **Security** — lifecycle scripts, shell-exec deps, secret/credential references, prompt-injection patterns, and hook events that run with your permissions.
- **Redundancy** — scans your local `.claude/` config, MCP servers, hooks, skills, and npm scripts, and tells you if the candidate just reinvents something you have.
- **Stack fit** — reads your permissions allowlist and project manifests (known locations only) to learn your stack, then notes whether the candidate targets it. *"Stack fit: targets Rust, which your setup doesn't show."* Advisory — it nudges the Workflow Fit score, never the verdict.
- **Maintenance** — license, staleness, release recency.
- **Setup burden & budget pressure** — global installs, tool-call volume, context bloat.

Findings drive everything. No finding, no verdict change.

## Install

### Claude Code

```text
/plugin marketplace add VectorSophie/hypecheck
/plugin install hypecheck@hypecheck
```

Then `/hypecheck <github-url | npm-package | x-link>`.

### CLI

```sh
npx @jackochesstern/hypecheck eval @modelcontextprotocol/server-filesystem
npx @jackochesstern/hypecheck eval https://github.com/owner/repo --json
npx @jackochesstern/hypecheck compare owner/repo-a owner/repo-b
npx @jackochesstern/hypecheck explain configured-hook
npx @jackochesstern/hypecheck audit
```

- `eval` — score one candidate. `--no-scan` skips the local redundancy/collision scan; `--scan <path>` points it at another project.
- `compare A B` — evaluate two candidates side by side.
- `explain <finding-id>` — why a finding matters and how to verify it yourself.
- `audit` — turn the lens on *your own* installed setup: redundant tools, hook collisions, and risky hooks you're already running.
- `--track` (on `eval`) — opt-in. Caches the candidate's public surface to `~/.hypecheck/` and, on the next `--track` run, flags **drift**: hooks or MCP servers added since you last vetted it (the rug-pull case). Off by default; reads/writes nothing without it, and never stores your config or secrets.

It also cross-references the candidate's hooks/MCP servers against your local `.claude` config and flags **collisions** — "adds a PostToolUse hook; you already run 2 on that event."

GitHub's unauthenticated API is 60 requests/hour. Set `GITHUB_TOKEN` to raise it to 5000/hr — Hypecheck reads it from the environment (or a local `.env`).

## Exit codes

`0` INSTALL/TRIAL · `1` SKIP/REDUNDANT/DANGEROUS · `2` bad input · `3` fetch/eval failure.

## Privacy

Local-first. It fetches public metadata for the candidate, and reads your local config to check redundancy. It never reads secret values, never phones home, and never auto-installs anything. The report shows what it scanned and what it couldn't verify.

## FAQ

**Is this a vulnerability scanner?**
No. `npm audit` and Socket already do CVEs well. Hypecheck answers a different question: should *you* install *this* agent tool, given what you already run?

**How is this different from SkillSpector / Vexscan?**
Those scan a plugin's code for malware patterns in isolation, and go deeper than Hypecheck on raw detection. Hypecheck is **context-aware**: it checks the candidate against *your* setup — redundancy, hook/MCP/command collisions, and drift since you last vetted it. A pattern scanner doesn't know what you already run. Different question, complementary tool.

**Will it catch a truly malicious package?**
It catches the tells — lifecycle scripts, shell deps, hook events, injection phrasing. It is advisory, not a guarantee. It tells you what it observed, inferred, and couldn't verify, so you decide.

**Does the plugin add a hook?**
No. A security tool that installs background execution to check for background execution would be a funny own goal. The slash command just calls the CLI.

## License

[MIT](LICENSE).
