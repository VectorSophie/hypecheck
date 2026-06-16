import test from 'node:test';
import assert from 'node:assert/strict';
import { tagCapabilities, matchStrength } from '../src/capabilities.js';

test('tags capabilities from free text by keyword', () => {
  const tags = tagCapabilities('An automated PR review bot powered by semgrep');
  assert.ok(tags.has('code-review'));
});

test('tags multiple families', () => {
  const tags = tagCapabilities('Run prettier to format and vitest for tests');
  assert.ok(tags.has('formatting'));
  assert.ok(tags.has('testing'));
});

test('returns empty set when nothing matches', () => {
  assert.equal(tagCapabilities('a quiet little poem about clouds').size, 0);
});

test('same family overlap is a strong match', () => {
  assert.equal(matchStrength(new Set(['testing']), new Set(['testing'])), 'strong');
});

test('same group different family is a weak match', () => {
  // linting and formatting both roll up to code-quality
  assert.equal(matchStrength(new Set(['linting']), new Set(['formatting'])), 'weak');
});

test('no shared family or group is no match', () => {
  assert.equal(matchStrength(new Set(['testing']), new Set(['database'])), 'none');
});
