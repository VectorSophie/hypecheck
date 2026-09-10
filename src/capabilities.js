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
  'coding-methodology': ['coding methodology', 'coding standard'],
  planning: ['project planning', 'roadmap', 'task breakdown', 'spec writing'],
  tdd: ['tdd', 'test-driven', 'test driven development'],
  debugging: ['debugger', 'debugging', 'stack trace', 'breakpoint'],
  // Deliberately co-occurs with the base `browser` family (both keywords
  // contain "browser") — an intentional is-a relationship, not an oversight.
  'browser-automation': ['browser automation', 'headless browser', 'e2e test'],
  // Deliberately avoids the word "research" (it contains "search" as a
  // literal substring — "web research" would silently also tag `search`,
  // coupling two unrelated capabilities by accident, not by design).
  'web-research': ['web browsing agent', 'internet lookup', 'crawls the web for information'],
  'social-research': ['social media monitoring', 'twitter analysis', 'reddit analysis'],
  deployment: ['deploy', 'deployment', 'ci/cd', 'release pipeline'],
  // Avoids the word "search" for the same reason web-research/social-research
  // do above — "semantic search"/"symbol search" would silently also tag the
  // unrelated `search` family, only reachable via ADJACENCY through the third
  // keyword otherwise.
  'semantic-code-nav': ['semantic code lookup', 'code navigation', 'jump to symbol'],
  lsp: ['language server', 'lsp ', 'go to definition'],
  'symbol-editing': ['rename symbol', 'refactor symbol', 'symbol editing'],
  'mcp-context-filtering': ['context filtering', 'mcp filter', 'tool filtering'],
  'token-compression': ['token compression', 'context compression', 'summarize context'],
  'memory-retrieval': ['memory retrieval', 'long-term memory', 'vector memory'],
  'cheap-model-delegation': ['cheap model', 'delegate to haiku', 'model routing'],
  'git-github': ['github api', 'github integration', 'pull request automation'],
  // ' aws' (leading space) rather than bare 'aws': the bare form is a
  // substring of ordinary words (draws, flaws, withdraws, paws) and would
  // false-positive on any README containing one of them.
  'cloud-provider': [' aws', 'gcp', 'azure', 'cloud provider'],
  'security-scanning': ['vulnerability scan', 'security scan', 'sast', 'dast'],
  'agent-orchestration': ['agent orchestration', 'multi-agent', 'subagent coordination'],
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

// Small, hardcoded adjacency table: related-but-distinct families. Deliberately
// tiny and manually curated (no embeddings) — grow it the same way FAMILIES
// grows, one considered pair at a time.
const ADJACENCY = [
  ['lsp', 'semantic-code-nav'],
  ['browser-automation', 'web-research'],
  ['search', 'semantic-code-nav'],
  ['git', 'git-github'],
  ['memory-retrieval', 'mcp-context-filtering'],
];

// Families that commonly pair on purpose — never flagged as redundant even
// when both appear on the same candidate/local-tool comparison.
const COMPLEMENTARY = [
  ['planning', 'tdd'],
  ['debugging', 'code-review'],
  ['deployment', 'security-scanning'],
];

function pairsConnect(aArr, bArr, pairs) {
  return pairs.some(([x, y]) => (aArr.includes(x) && bArr.includes(y)) || (aArr.includes(y) && bArr.includes(x)));
}

// Deterministic overlap classification between two capability-tag sets
// (e.g. a candidate's tags vs. one local tool's tags). Distinct from
// matchStrength (which analyze.js's redundant-capability/redundant-adjacent
// findings already use and keep using unchanged) — this is richer
// classification feeding NEW secondary labels only, not a replacement.
export function classifyOverlap(aTags, bTags) {
  if (aTags.size === 0 || bTags.size === 0) return 'none';

  const aArr = [...aTags];
  const bArr = [...bTags];

  if (aTags.size === bTags.size && aArr.every((t) => bTags.has(t))) return 'exact-duplicate';
  if (aArr.some((t) => bTags.has(t))) return 'strong-overlap';
  if (pairsConnect(aArr, bArr, ADJACENCY)) return 'adjacent';
  if (pairsConnect(aArr, bArr, COMPLEMENTARY)) return 'complementary';
  return 'none';
}
