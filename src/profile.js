// Fit profile: derive a coarse picture of the user's stack from low-risk,
// known-location signals only. Never crawls the disk, never reads secret
// values, never persists or transmits anything (see spec privacy lines).
// ponytail: keyword map over languages, same shape as capabilities.js.

const join = (...parts) => parts.join('/');

// Stack vocabulary — languages/ecosystems, distinct from capability families.
const TECH = {
  js: ['javascript', 'node', 'npm', 'react', 'vue', 'next.js', 'eslint', 'webpack', 'yarn', 'pnpm'],
  ts: ['typescript', 'tsconfig', 'tsx'],
  python: ['python', 'pyproject', 'pip ', 'django', 'flask', 'pytest', 'numpy', 'pandas'],
  go: ['golang', 'go.mod', 'go build', 'go test'],
  rust: ['rust', 'cargo', 'crates.io'],
  ruby: ['ruby', 'rails', 'gemfile', 'bundler'],
  docker: ['docker', 'kubernetes', 'kubectl', 'helm'],
  data: ['bigquery', ' bq ', 'postgres', 'psql', 'snowflake', ' sql'],
};

// Project manifests are an unambiguous language signal; map them directly
// rather than keyword-sniffing the filename.
const MANIFEST_TECH = {
  'package.json': 'js',
  'tsconfig.json': 'ts',
  'pyproject.toml': 'python',
  'requirements.txt': 'python',
  'go.mod': 'go',
  'Cargo.toml': 'rust',
  Gemfile: 'ruby',
  Dockerfile: 'docker',
};

export function tagTech(text) {
  const haystack = ` ${String(text ?? '').toLowerCase()} `;
  const tags = new Set();
  for (const [tag, keywords] of Object.entries(TECH)) {
    if (keywords.some((kw) => haystack.includes(kw))) tags.add(tag);
  }
  return tags;
}

export function profileUser({ cwd, home, fs } = {}) {
  const techTags = new Set();
  const add = (tag) => tag && techTags.add(tag);

  const exists = (path) => {
    try { fs.readFileSync(path); return true; } catch { return false; }
  };
  const readJson = (path) => {
    try { return JSON.parse(fs.readFileSync(path)); } catch { return null; }
  };

  // Permissions allowlist — command patterns reveal the stack & risk tolerance.
  const scanAllow = (path) => {
    const allow = readJson(path)?.permissions?.allow;
    for (const pattern of Array.isArray(allow) ? allow : []) {
      for (const tag of tagTech(pattern)) add(tag);
    }
  };

  if (cwd) {
    scanAllow(join(cwd, '.claude', 'settings.json'));
    scanAllow(join(cwd, '.claude', 'settings.local.json'));
    // Project manifests in the scan target -> language tags.
    for (const [file, tag] of Object.entries(MANIFEST_TECH)) {
      if (exists(join(cwd, file))) add(tag);
    }
  }
  if (home) {
    scanAllow(join(home, '.claude', 'settings.json'));
  }

  return { techTags };
}
