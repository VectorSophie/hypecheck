# Sample reports

These are real `hypecheck eval` outputs, captured by actually running the
CLI — not hand-written examples. Regenerate them any time with:

```sh
node bin/hypecheck.js eval <candidate> --no-scan > docs/samples/<name>.md
```

- [`modelcontextprotocol-server-filesystem.md`](./modelcontextprotocol-server-filesystem.md)
  — `hypecheck eval @modelcontextprotocol/server-filesystem`. INSTALL
  verdict, but flags a `package.json` lifecycle script (`prepare`) as a
  high-severity finding worth a look — a "mostly fine, still worth reading
  the evidence" example.
- [`nanoid.md`](./nanoid.md) — `hypecheck eval nanoid`. Clean INSTALL with
  no concrete risk findings and low confidence (there just isn't much
  metadata to go on) — shows what a near-empty evidence section looks like.
- [`sindresorhus-np.md`](./sindresorhus-np.md) — `hypecheck eval
  sindresorhus/np`. A GitHub repo example that lands on TRIAL instead of
  INSTALL, driven by a high-severity finding that its dependencies include
  a shell/process execution package (`execa`) — np is a publish-automation
  CLI that legitimately shells out, so this is an accurate, unsurprising
  flag rather than an accusation.

All three were run with `--no-scan`, so each report's "Could Not Verify"
section notes that local Claude Code context was not scanned.
