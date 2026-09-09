import test from 'node:test';
import assert from 'node:assert/strict';
import { extractClaimedSavings, detectMechanismKeywords } from '../src/token-economics.js';

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
