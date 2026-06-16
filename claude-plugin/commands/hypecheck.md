# /hypecheck

Evaluate a GitHub repository, npm package, npm URL, or X/Twitter link before installing it as a Claude Code/plugin/MCP/agent/dev tool.

```sh
npx @jackochesstern/hypecheck eval "$ARGUMENTS"
```

Return the full Markdown report to the user. Preserve the blunt verdict and the evidence sections.

If the command fails because no candidate link can be extracted from a social URL, ask the user to paste the underlying GitHub or npm link.
