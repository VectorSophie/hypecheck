// Capability tagging: keyword families with a light semantic grouping.
// ponytail: keyword map, not embeddings. Grow FAMILIES one line at a time.

const FAMILIES = {
  'code-review': ['review', 'semgrep', 'codeql', 'pr review'],
  linting: ['lint', 'eslint', 'ruff'],
  formatting: ['format', 'prettier', 'style'],
  testing: ['test', 'jest', 'vitest', 'pytest', 'coverage'],
  browser: ['browser', 'playwright', 'puppeteer', 'screenshot'],
  fetch: ['fetch', 'http client', 'scrape', 'crawl'],
  search: ['search', 'ripgrep', 'grep', 'find files'],
  git: ['git ', 'commit', 'github cli', 'gh '],
  database: ['database', 'sql', 'postgres', 'sqlite'],
  docs: ['docs', 'documentation', 'readme generator'],
};

// Families that roll up into a broader capability group (the "hint of C").
const GROUPS = {
  'code-quality': ['code-review', 'linting', 'formatting'],
};

const FAMILY_TO_GROUP = Object.fromEntries(
  Object.entries(GROUPS).flatMap(([group, families]) => families.map((f) => [f, group])),
);

export function tagCapabilities(text) {
  const haystack = ` ${String(text ?? '').toLowerCase()} `;
  const tags = new Set();
  for (const [family, keywords] of Object.entries(FAMILIES)) {
    if (keywords.some((kw) => haystack.includes(kw))) {
      tags.add(family);
    }
  }
  return tags;
}

export function matchStrength(aTags, bTags) {
  for (const tag of aTags) {
    if (bTags.has(tag)) return 'strong';
  }
  const aGroups = new Set([...aTags].map((t) => FAMILY_TO_GROUP[t]).filter(Boolean));
  for (const tag of bTags) {
    if (aGroups.has(FAMILY_TO_GROUP[tag])) return 'weak';
  }
  return 'none';
}
