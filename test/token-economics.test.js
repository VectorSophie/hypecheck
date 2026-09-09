import test from 'node:test';
import assert from 'node:assert/strict';
import { extractClaimedSavings } from '../src/token-economics.js';

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
