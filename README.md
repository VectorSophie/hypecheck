# Hypecheck

Before installing another agent/dev tool, run it through Hypecheck.

Hypecheck is a local-first evaluator for Claude Code plugins, MCP servers, hooks, slash commands, agent workflows, npm packages, and adjacent dev tools. It gives a blunt verdict backed by serious evidence: security risk, maintenance health, setup burden, budget/context pressure, and overkill.

## Current MVP

This first slice includes:

- candidate normalization for GitHub, npm, and X/Twitter links
- public GitHub repository metadata and README fetching
- npm registry metadata fetching
- social-link extraction for GitHub/npm links
- heuristic findings for lifecycle scripts, shell execution dependencies, missing licenses, stale maintenance, secret references, and agent-tooling scope
- scored JSON and Markdown reports
- a Claude Code plugin-facing slash command scaffold

No hosted service is required.

## CLI

```sh
hypecheck eval <github-url | npm-package | npm-url | x-twitter-url>
hypecheck eval <candidate> --json
```

Examples:

```sh
hypecheck eval @modelcontextprotocol/server-filesystem
hypecheck eval https://github.com/modelcontextprotocol/servers --json
```

Exit codes:

- `0`: report generated with `INSTALL` or `TRIAL`
- `1`: report generated with `SKIP`, `REDUNDANT`, or `DANGEROUS`
- `2`: invalid command/input
- `3`: fetch/evaluation failure

## Development

This repo currently uses Node.js ESM and the built-in Node test runner.

```sh
node --test
```

The Codex desktop bundled Node runtime can also run the suite directly:

```powershell
& 'C:\Users\PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test
```

## Claude Code Plugin Scaffold

See [`claude-plugin/`](claude-plugin/) for the initial command scaffold. The v1 plugin command invokes the local CLI instead of adding hooks or always-on background behavior.
