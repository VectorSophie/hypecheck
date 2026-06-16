# Hypecheck Claude Code Plugin Scaffold

This directory contains the first plugin-facing surface for Hypecheck.

The intended user action is:

```text
/hypecheck <github-url | npm-package | npm-url | x-twitter-url>
```

The command should call the local CLI:

```sh
npx hypecheck eval "$ARGUMENTS"
```

V1 deliberately avoids installing Claude Code hooks. Hypecheck is a security-adjacent evaluator; adding always-on background execution by default would expand the blast radius before the user has even asked a question.

Exact marketplace/plugin manifest packaging is deferred until the Claude Code plugin format is locked for the first packaged release.
