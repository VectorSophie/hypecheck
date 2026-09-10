import test from 'node:test';
import assert from 'node:assert/strict';
import { tagCapabilities, matchStrength, classifyOverlap } from '../src/capabilities.js';

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

test('classifyOverlap: identical non-empty tag sets are an exact duplicate', () => {
  const a = new Set(['testing']);
  const b = new Set(['testing']);
  assert.equal(classifyOverlap(a, b), 'exact-duplicate');
});

test('classifyOverlap: shared family among a larger, non-identical set is strong overlap', () => {
  const a = new Set(['testing', 'linting']);
  const b = new Set(['testing']);
  assert.equal(classifyOverlap(a, b), 'strong-overlap');
});

test('classifyOverlap: lsp and semantic-code-nav are adjacent', () => {
  const a = new Set(['lsp']);
  const b = new Set(['semantic-code-nav']);
  assert.equal(classifyOverlap(a, b), 'adjacent');
});

test('classifyOverlap: planning and tdd are complementary, never redundant', () => {
  const a = new Set(['planning']);
  const b = new Set(['tdd']);
  assert.equal(classifyOverlap(a, b), 'complementary');
});

test('classifyOverlap: unrelated families are none', () => {
  const a = new Set(['formatting']);
  const b = new Set(['database']);
  assert.equal(classifyOverlap(a, b), 'none');
});

test('classifyOverlap: an empty tag set on either side is none', () => {
  assert.equal(classifyOverlap(new Set(), new Set(['testing'])), 'none');
  assert.equal(classifyOverlap(new Set(['testing']), new Set()), 'none');
});

test('new Phase 5 families are tagged from representative keywords', () => {
  assert.ok(tagCapabilities('a TDD workflow skill').has('tdd'));
  assert.ok(tagCapabilities('multi-agent orchestration framework').has('agent-orchestration'));
  assert.ok(tagCapabilities('language server protocol navigation').has('lsp'));
  assert.ok(tagCapabilities('deploys to aws and gcp').has('cloud-provider'));
});

test('existing families are untouched by the expansion', () => {
  assert.ok(tagCapabilities('runs prettier').has('formatting'));
  assert.ok(tagCapabilities('a jest test runner').has('testing'));
});

test('cloud-provider "aws" keyword does not false-positive on ordinary words containing that substring', () => {
  assert.equal(tagCapabilities('This tool draws inspiration from several projects').has('cloud-provider'), false);
  assert.equal(tagCapabilities('Highlights flaws in your code').has('cloud-provider'), false);
  assert.equal(tagCapabilities('Automatically withdraws stale branches').has('cloud-provider'), false);
});

test('web-research and social-research do not accidentally tag the unrelated search family', () => {
  assert.equal(tagCapabilities('a web browsing agent for internet lookup').has('search'), false);
  assert.equal(tagCapabilities('does twitter analysis and reddit analysis').has('search'), false);
});

test('a plain code-search tool and an unrelated web-research tool are not reported as strongly overlapping', () => {
  const codeSearchTags = tagCapabilities('ripgrep-based code search');
  const webResearchTags = tagCapabilities('a web browsing agent for internet lookup');
  assert.ok(codeSearchTags.has('search'));
  assert.ok(webResearchTags.has('web-research'));
  assert.equal(classifyOverlap(codeSearchTags, webResearchTags), 'none');
});
