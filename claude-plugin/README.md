# Hypecheck Claude Code Plugin Scaffold

This directory contains the first plugin-facing surface for Hypecheck.

The intended user action is:

```text
/hypecheck <github-url | npm-package | npm-url | x-twitter-url>
```

The command should call the local CLI:

```sh
npx @jackochesstern/hypecheck eval "$ARGUMENTS"
```

V1 deliberately avoids installing Claude Code hooks. Hypecheck is a security-adjacent evaluator; adding always-on background execution by default would expand the blast radius before the user has even asked a question.

## Packaging

- `.claude-plugin/plugin.json` — this plugin's manifest. `commands/hypecheck.md` is auto-discovered as `/hypecheck`.
- The repo-root `.claude-plugin/marketplace.json` lists this plugin (`source: ./claude-plugin`), so the marketplace can be added straight from the GitHub repo.
- `/hypecheck` shells out to `npx @jackochesstern/hypecheck eval`, which resolves to the published npm package.
