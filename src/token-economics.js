// Evidence-tiered token/context economics analysis: never turns a README
// sentence directly into a numeric score. `computeTokenEconomics` (bottom of
// this file) is the entry point most callers want — the functions above it
// are its independently-testable building blocks.

// "cut" deliberately does NOT get gerund support here (no "cutting") —
// "cutting-edge" is extremely common marketing phrasing and would false-
// positive-match against any nearby percentage (e.g. "a cutting-edge tool,
// 100% test coverage"). "saving"/"reducing"/"shrinking" don't have a
// comparably common idiomatic collision, so they keep gerund support.
const SAVINGS_PATTERN = /(?:sav(?:es?|ing)|reduc(?:es?|ing)|cuts?|shrink(?:s|ing)?)\b[^.\n%]{0,60}?(\d{1,3})\s*%|(\d{1,3})\s*%\s*(?:reduction|savings?|smaller|fewer|less)\b/i;

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

// Combines the three signal detectors above into one evidence-tiered
// result. Tier ladder (most to least trustworthy): benchmarked >
// observed-from-repo > inferred > claimed > unknown. `mechanisms.fromSource`
// only ever comes from ACTUALLY FETCHED hook script text (data.hookScripts,
// from Phase 2's discovery) — never from README prose, which is why a
// mechanism keyword appearing there ranks below one found in real source.
export function computeTokenEconomics(data, discovery) {
  const readmeText = data?.readme ?? data?.html ?? '';
  const sourceText = Object.values(data?.hookScripts ?? {}).join('\n');

  const claim = extractClaimedSavings(readmeText);
  const readmeMechanisms = detectMechanismKeywords(readmeText);
  const sourceMechanisms = detectMechanismKeywords(sourceText);
  const benchmark = detectBenchmarkEvidence(discovery?.scanned, discovery?.skipped);

  let evidenceTier = 'unknown';
  if (benchmark.present) evidenceTier = 'benchmarked';
  else if (sourceMechanisms.size > 0) evidenceTier = 'observed-from-repo';
  else if (readmeMechanisms.size > 0) evidenceTier = 'inferred';
  else if (claim) evidenceTier = 'claimed';

  const labels = [];
  if (evidenceTier === 'benchmarked' || evidenceTier === 'observed-from-repo') {
    labels.push('TOKEN_WIN');
  } else if (evidenceTier === 'claimed' || evidenceTier === 'inferred') {
    labels.push('TOKEN_UNPROVEN');
  }

  return {
    evidenceTier,
    claim,
    mechanisms: {
      fromSource: [...sourceMechanisms],
      fromReadme: [...readmeMechanisms],
    },
    benchmark,
    labels,
  };
}
