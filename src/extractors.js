export function extractCandidateLinks(text) {
  const found = new Set();
  const pattern = /https?:\/\/(?:github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|www\.npmjs\.com\/package\/(?:%40[^/\s"'<>]+%2F[^/\s"'<>]+|@?[^/\s"'<>]+)|npmjs\.com\/package\/[^/\s"'<>]+)/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    found.add(match[0]);
  }

  return [...found];
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
