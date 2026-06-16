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

```text
$ hypecheck eval https://github.com/some/code-graph-mcp

# Hypecheck: some/code-graph-mcp

Verdict: DANGEROUS

Dangerous. This touches sharp objects and acts casual about it:
package.json declares lifecycle script(s): prepare.

## Scores
- Security Risk: 10/10
- Overkill Index: 100/100
- Maintenance Health: 8/10
- Redundancy: 1/10

## Evidence
- [HIGH] Package lifecycle script: declares prepare.
- [HIGH] Secret or credential access mentioned in README/metadata.
- [HIGH] Sensitive hook event: references a PreToolUse hook, which runs
  shell commands with full user permissions.
- [LOW]  Agent tooling candidate: affects Claude Code / MCP / hooks / agents.
```

Exit code is `1`. Your CI can read that.

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
```

`--no-scan` skips the local redundancy scan. `--scan <path>` points it at another project.

GitHub's unauthenticated API is 60 requests/hour. Set `GITHUB_TOKEN` to raise it to 5000/hr — Hypecheck reads it from the environment.

## Exit codes

`0` INSTALL/TRIAL · `1` SKIP/REDUNDANT/DANGEROUS · `2` bad input · `3` fetch/eval failure.

## Privacy

Local-first. It fetches public metadata for the candidate, and reads your local config to check redundancy. It never reads secret values, never phones home, and never auto-installs anything. The report shows what it scanned and what it couldn't verify.

## FAQ

**Is this a vulnerability scanner?**
No. `npm audit` and Socket already do CVEs well. Hypecheck answers a different question: should *you* install *this* agent tool, given what you already run?

**Will it catch a truly malicious package?**
It catches the tells — lifecycle scripts, shell deps, hook events, injection phrasing. It is advisory, not a guarantee. It tells you what it observed, inferred, and couldn't verify, so you decide.

**Does the plugin add a hook?**
No. A security tool that installs background execution to check for background execution would be a funny own goal. The slash command just calls the CLI.

## License

[MIT](LICENSE).
