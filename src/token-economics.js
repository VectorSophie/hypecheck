// Evidence-tiered token/context economics analysis: never turns a README
// sentence directly into a numeric score. `computeTokenEconomics` (bottom of
// this file) is the entry point most callers want — the functions above it
// are its independently-testable building blocks.

const SAVINGS_PATTERN = /(?:saves?|reduces?|cuts?|shrinks?)\b[^.\n%]{0,60}?(\d{1,3})\s*%|(\d{1,3})\s*%\s*(?:reduction|savings?|smaller|fewer|less)\b/i;

// Extracts a percentage-based savings claim from free text (a README, a
// package description, etc). Returns { percentage, quote } or null. A
// "claim" here is ONLY ever evidence of what the repo SAYS about itself —
// never treated as a verified number anywhere downstream.
export function extractClaimedSavings(text) {
  if (!text || typeof text !== 'string') return null;

  const match = text.match(SAVINGS_PATTERN);
  if (!match) return null;

  const percentage = Number(match[1] ?? match[2]);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) return null;

  return { percentage, quote: match[0].trim() };
}

const MECHANISM_FAMILIES = {
  'cheap-model-delegation': ['cheap model', 'cheaper model', 'haiku', 'smaller model', 'delegate to a', 'routes to a cheap'],
  'subagent-isolation': ['subagent', 'sub-agent', 'isolated context', 'spawns a subagent'],
  caching: ['cache', 'cached', 'caching', 'memoiz'],
  'deferred-loading': ['lazy load', 'loaded on demand', 'on-demand', 'deferred loading', 'tool search'],
  compression: ['compress', 'summariz', 'truncat', 'minif'],
  retrieval: ['retrieval', 'semantic search', 'vector index', 'vector store', 'embedding'],
  filtering: ['filter', 'strips', 'strip irrelevant', 'prune', 'noisy output'],
};

// Keyword-family detection of token-saving mechanisms in free text. Same
// deterministic, no-embeddings approach as src/capabilities.js's FAMILIES —
// grow one line at a time, not a scoring model.
export function detectMechanismKeywords(text) {
  const haystack = ` ${String(text ?? '').toLowerCase()} `;
  const mechanisms = new Set();
  for (const [family, keywords] of Object.entries(MECHANISM_FAMILIES)) {
    if (keywords.some((kw) => haystack.includes(kw))) {
      mechanisms.add(family);
    }
  }
  return mechanisms;
}

const BENCHMARK_DIR = /(^|\/)(?:bench|benchmarks?|evals?|evaluations?)\//i;

// Structural signal: does a benchmark/eval directory exist in the repo at
// all? Reuses discovery's already-collected path lists (both the files it
// actually fetched, `scanned`, and the ones it looked at but skipped as
// uninteresting, `skipped`) — no new network fetch. Presence-only: this
// does NOT read benchmark result content, just proves a checked-in
// benchmark harness exists somewhere in the scanned portion of the repo.
export function detectBenchmarkEvidence(scanned = [], skipped = []) {
  const allPaths = [...(scanned ?? []), ...(skipped ?? []).map((s) => s.path)];
  const paths = allPaths.filter((p) => BENCHMARK_DIR.test(p));
  return { present: paths.length > 0, paths };
}
