import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAnalysis } from '../src/score.js';

const base = (findings, extra = {}) => ({
  candidate: { canonical: 'x' }, targetName: 't', findings, ...extra,
});

test('redundancy score rises with strong and weak overlaps', () => {
  const scored = scoreAnalysis(base([
    { id: 'redundant-capability', category: 'redundancy', severity: 'medium', strength: 'strong', title: '', evidence: '' },
    { id: 'redundant-adjacent', category: 'redundancy', severity: 'low', strength: 'weak', title: '', evidence: '' },
  ]));
  // 1 + 3*1 + 1*1 = 5
  assert.equal(scored.scores.redundancy, 5);
});

test('emits REDUNDANT verdict on heavy overlap with no unique capability', () => {
  const scored = scoreAnalysis(base([
    { id: 'redundant-capability', category: 'redundancy', severity: 'medium', strength: 'strong', title: '', evidence: '' },
    { id: 'redundant-installed', category: 'redundancy', severity: 'medium', strength: 'strong', title: '', evidence: '' },
  ], { hasUniqueCapability: false }));
  assert.equal(scored.scores.redundancy >= 6, true);
  assert.equal(scored.verdict, 'REDUNDANT');
});

test('does not mark REDUNDANT when candidate adds a unique capability', () => {
  const scored = scoreAnalysis(base([
    { id: 'redundant-capability', category: 'redundancy', severity: 'medium', strength: 'strong', title: '', evidence: '' },
    { id: 'redundant-installed', category: 'redundancy', severity: 'medium', strength: 'strong', title: '', evidence: '' },
  ], { hasUniqueCapability: true }));
  assert.notEqual(scored.verdict, 'REDUNDANT');
});

test('redundancy floor is 1 with no overlaps', () => {
  assert.equal(scoreAnalysis(base([])).scores.redundancy, 1);
});
