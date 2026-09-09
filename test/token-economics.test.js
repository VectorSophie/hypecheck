import test from 'node:test';
import assert from 'node:assert/strict';
import { extractClaimedSavings, detectMechanismKeywords, detectBenchmarkEvidence, computeTokenEconomics } from '../src/token-economics.js';

test('extracts a "saves N%" style claim', () => {
  const result = extractClaimedSavings('This tool saves 98% of your context by routing bulk reads elsewhere.');
  assert.equal(result.percentage, 98);
  assert.match(result.quote, /saves 98%/);
});

test('extracts a "N% reduction" style claim', () => {
  const result = extractClaimedSavings('Benchmarks show a 73% reduction in tokens for typical workloads.');
  assert.equal(result.percentage, 73);
});

test('extracts a "cuts token usage by N%" style claim', () => {
  const result = extractClaimedSavings('It cuts token usage by 40% on average.');
  assert.equal(result.percentage, 40);
});

test('returns null when no savings claim is present', () => {
  assert.equal(extractClaimedSavings('A generic MCP server for querying a database.'), null);
});

test('returns null for out-of-range or nonsensical percentages', () => {
  assert.equal(extractClaimedSavings('Test coverage is at 150% this quarter.'), null);
});

test('returns null for empty or missing input', () => {
  assert.equal(extractClaimedSavings(''), null);
  assert.equal(extractClaimedSavings(undefined), null);
});

test('detects cheap-model delegation mentions', () => {
  const mechanisms = detectMechanismKeywords('Routes bulk file reads to a cheaper model before summarizing.');
  assert.ok(mechanisms.has('cheap-model-delegation'));
});

test('detects subagent isolation mentions', () => {
  const mechanisms = detectMechanismKeywords('Spawns a subagent to do the heavy lifting in an isolated context.');
  assert.ok(mechanisms.has('subagent-isolation'));
});

test('detects caching mentions', () => {
  const mechanisms = detectMechanismKeywords('Results are cached between calls to avoid redundant work.');
  assert.ok(mechanisms.has('caching'));
});

test('detects deferred/lazy loading mentions', () => {
  const mechanisms = detectMechanismKeywords('Tool schemas are loaded on demand instead of all upfront.');
  assert.ok(mechanisms.has('deferred-loading'));
});

test('detects compression mentions', () => {
  const mechanisms = detectMechanismKeywords('Output is compressed and truncated before returning to the model.');
  assert.ok(mechanisms.has('compression'));
});

test('detects retrieval/memory mentions', () => {
  const mechanisms = detectMechanismKeywords('Uses semantic search over a vector index instead of full-text dumps.');
  assert.ok(mechanisms.has('retrieval'));
});

test('detects filtering mentions', () => {
  const mechanisms = detectMechanismKeywords('Strips irrelevant fields and filters noisy output.');
  assert.ok(mechanisms.has('filtering'));
});

test('returns an empty set for text with no mechanism keywords', () => {
  const mechanisms = detectMechanismKeywords('A simple utility with no special behavior.');
  assert.equal(mechanisms.size, 0);
});

test('mechanism detection is null-safe', () => {
  assert.equal(detectMechanismKeywords(undefined).size, 0);
  assert.equal(detectMechanismKeywords('').size, 0);
});

test('detects a benchmark directory in scanned paths', () => {
  const result = detectBenchmarkEvidence(['bench/baseline.json', 'src/index.js'], []);
  assert.equal(result.present, true);
  assert.deepEqual(result.paths, ['bench/baseline.json']);
});

test('detects a benchmark directory in skipped paths (not every file needs fetching to prove presence)', () => {
  const result = detectBenchmarkEvidence([], [{ path: 'benchmarks/results.csv', reason: 'not-interesting' }]);
  assert.equal(result.present, true);
  assert.deepEqual(result.paths, ['benchmarks/results.csv']);
});

test('detects an eval directory', () => {
  const result = detectBenchmarkEvidence(['evals/run.py'], []);
  assert.equal(result.present, true);
});

test('does not false-positive on unrelated paths', () => {
  const result = detectBenchmarkEvidence(['src/index.js', 'docs/README.md'], [{ path: 'test/foo.test.js', reason: 'not-interesting' }]);
  assert.equal(result.present, false);
  assert.deepEqual(result.paths, []);
});

test('handles missing/empty inputs safely', () => {
  assert.deepEqual(detectBenchmarkEvidence(), { present: false, paths: [] });
  assert.deepEqual(detectBenchmarkEvidence([], []), { present: false, paths: [] });
});

test('computeTokenEconomics: benchmark present is the top tier, even with other evidence', () => {
  const data = { readme: 'Saves 90% of tokens by routing to a cheaper model.', hookScripts: {} };
  const discovery = { scanned: ['bench/results.json'], skipped: [] };
  const result = computeTokenEconomics(data, discovery);
  assert.equal(result.evidenceTier, 'benchmarked');
  assert.equal(result.claim.percentage, 90);
  assert.equal(result.benchmark.present, true);
  assert.ok(result.labels.includes('TOKEN_WIN'));
});

test('computeTokenEconomics: mechanism found in real hook source (not just README) is observed-from-repo', () => {
  const data = { readme: 'A helpful hook.', hookScripts: { 'hooks/route.js': 'delegate to a cheaper model for bulk reads' } };
  const discovery = { scanned: [], skipped: [] };
  const result = computeTokenEconomics(data, discovery);
  assert.equal(result.evidenceTier, 'observed-from-repo');
  assert.ok(result.mechanisms.fromSource.includes('cheap-model-delegation'));
  assert.ok(result.labels.includes('TOKEN_WIN'));
});

test('computeTokenEconomics: mechanism mentioned only in README (no source evidence) is inferred', () => {
  const data = { readme: 'This tool uses a semantic search index to filter results.', hookScripts: {} };
  const discovery = { scanned: [], skipped: [] };
  const result = computeTokenEconomics(data, discovery);
  assert.equal(result.evidenceTier, 'inferred');
  assert.ok(result.mechanisms.fromReadme.includes('retrieval'));
  assert.equal(result.mechanisms.fromSource.length, 0);
  assert.ok(result.labels.includes('TOKEN_UNPROVEN'));
});

test('computeTokenEconomics: a bare percentage claim with no mechanism or benchmark evidence is claimed-only', () => {
  const data = { readme: 'Saves 98% of your context window.', hookScripts: {} };
  const discovery = { scanned: [], skipped: [] };
  const result = computeTokenEconomics(data, discovery);
  assert.equal(result.evidenceTier, 'claimed');
  assert.equal(result.claim.percentage, 98);
  assert.ok(result.labels.includes('TOKEN_UNPROVEN'));
});

test('computeTokenEconomics: nothing found at all is unknown, with no labels', () => {
  const data = { readme: 'A simple utility.', hookScripts: {} };
  const discovery = { scanned: [], skipped: [] };
  const result = computeTokenEconomics(data, discovery);
  assert.equal(result.evidenceTier, 'unknown');
  assert.equal(result.claim, null);
  assert.deepEqual(result.labels, []);
});

test('computeTokenEconomics: falls back to html for social-derived data, and tolerates missing discovery', () => {
  const data = { html: 'Saves 50% of tokens.', hookScripts: undefined };
  const result = computeTokenEconomics(data, undefined);
  assert.equal(result.evidenceTier, 'claimed');
});
