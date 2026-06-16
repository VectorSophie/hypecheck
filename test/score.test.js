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

test('roast summary cites the most damning finding', () => {
  const scored = scoreAnalysis(base([
    { id: 'secret-reference', category: 'security', severity: 'high', title: 'Secret access', evidence: 'README references .env files.' },
    { id: 'missing-license', category: 'maintenance', severity: 'medium', title: 'No license', evidence: 'No license found.' },
  ]));
  // the high-severity finding wins over the medium one
  assert.match(scored.summary, /\.env/);
});

test('roast summary for REDUNDANT names the overlap', () => {
  const scored = scoreAnalysis(base([
    { id: 'redundant-installed', category: 'redundancy', severity: 'medium', strength: 'strong', title: 't', evidence: 'Already installed locally as dep `prettier`.' },
    { id: 'redundant-capability', category: 'redundancy', severity: 'medium', strength: 'strong', title: 't', evidence: 'Overlaps with your existing skill `review`.' },
  ], { hasUniqueCapability: false }));
  assert.equal(scored.verdict, 'REDUNDANT');
  assert.match(scored.summary, /prettier|review/);
});

test('positive verdict frames a risky finding as a caveat, not the verdict reason', () => {
  const scored = scoreAnalysis(base([
    { id: 'secret-reference', category: 'security', severity: 'high', title: 't', evidence: 'README references .env files.' },
  ]));
  assert.equal(scored.verdict, 'INSTALL');
  assert.match(scored.summary, /Worth a closer look/);
  // must NOT read as "...does not scream at us yet: README references .env" (self-contradiction)
  assert.ok(!/yet: README/.test(scored.summary));
});

test('clean positive verdict with only a low finding stays terse', () => {
  const scored = scoreAnalysis(base([
    { id: 'agent-tooling-scope', category: 'workflow', severity: 'low', title: 't', evidence: 'It is an agent tool.' },
  ]));
  assert.equal(scored.verdict, 'INSTALL');
  assert.doesNotMatch(scored.summary, /Worth a closer look/);
});

test('roast summary still works with no findings', () => {
  const scored = scoreAnalysis(base([]));
  assert.equal(typeof scored.summary, 'string');
  assert.ok(scored.summary.length > 0);
});
