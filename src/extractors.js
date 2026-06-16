export function extractCandidateLinks(text) {
  const found = new Set();
  const pattern = /https?:\/\/(?:github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|www\.npmjs\.com\/package\/(?:%40[^/\s"'<>]+%2F[^/\s"'<>]+|@?[^/\s"'<>]+)|npmjs\.com\/package\/[^/\s"'<>]+)/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    found.add(match[0]);
  }

  return [...found];
}

// Hook config lives either inline in plugin.json.hooks or in hooks/hooks.json.
// Both share the shape { EventName: [{ matcher?, hooks: [{ command }] }] }, and
// hooks.json wraps it under a top-level "hooks" key. Flatten to event/command pairs.
export function extractHookEvents(manifests) {
  const sources = [manifests?.plugin?.hooks, manifests?.hooks?.hooks ?? manifests?.hooks];
  const events = [];
  for (const map of sources) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const [event, matchers] of Object.entries(map)) {
      for (const matcher of Array.isArray(matchers) ? matchers : []) {
        for (const hook of matcher?.hooks ?? []) {
          events.push({ event, command: hook?.command ?? '' });
        }
      }
    }
  }
  return events;
}

export function extractMcpServers(manifests) {
  const servers = { ...(manifests?.mcp?.mcpServers ?? {}), ...(manifests?.plugin?.mcpServers ?? {}) };
  return Object.entries(servers).map(([name, cfg]) => ({
    name,
    command: cfg?.command ?? '',
    needsSecrets: Boolean(cfg?.env || cfg?.headers), // presence only — values never read
  }));
}

export function extractPackageSignals(data) {
  const pkg = data.package ?? {};

  return {
    lifecycleScripts: Object.keys(pkg.scripts ?? {}).filter((name) =>
      ['preinstall', 'install', 'postinstall', 'prepare'].includes(name)
    ),
    scripts: Object.keys(pkg.scripts ?? {}),
    dependencies: Object.keys(pkg.dependencies ?? {}),
    devDependencies: Object.keys(pkg.devDependencies ?? {}),
    bins: typeof pkg.bin === 'string' ? [data.metadata?.name].filter(Boolean) : Object.keys(pkg.bin ?? {}),
    repository: data.metadata?.repository ?? null,
  };
}
