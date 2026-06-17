import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCandidate } from '../src/analyze.js';
import { scoreAnalysis } from '../src/score.js';

const NOW = new Date('2026-06-17T00:00:00Z');

function rustCandidate() {
  return {
    source: 'github',
    candidate: { canonical: 'owner/repo' },
    metadata: { name: 'repo', license: 'MIT', language: 'Rust', pushedAt: NOW.toISOString() },
    readme: 'A rust crate you build with cargo.',
    manifests: {},
  };
}

function score(data, userProfile) {
  return scoreAnalysis(analyzeCandidate(data, { now: NOW, userProfile }));
}

test('Workflow Fit unchanged with no profile', () => {
  const report = score(rustCandidate(), undefined);
  assert.equal(report.scores.workflowFit, 4);
  assert.equal(report.fit?.signal ?? 'none', 'none');
});

test('Workflow Fit rises when candidate stack matches the user profile', () => {
  const report = score(rustCandidate(), { techTags: new Set(['rust']) });
  assert.ok(report.scores.workflowFit > 4);
  assert.equal(report.fit.signal, 'match');
});

test('Workflow Fit drops when candidate targets a stack the user does not show', () => {
  const report = score(rustCandidate(), { techTags: new Set(['ts']) });
  assert.ok(report.scores.workflowFit < 4);
  assert.equal(report.fit.signal, 'mismatch');
});

test('no fit signal when the candidate is not stack-specific', () => {
  const generic = { ...rustCandidate(), metadata: { name: 'repo', license: 'MIT', pushedAt: NOW.toISOString() }, readme: 'A friendly helper.' };
  const report = score(generic, { techTags: new Set(['rust']) });
  assert.equal(report.fit.signal, 'none');
  assert.equal(report.scores.workflowFit, 4);
});

test('fit never drives the verdict by itself', () => {
  // A clean candidate stays INSTALL whether fit matches or mismatches.
  assert.equal(score(rustCandidate(), { techTags: new Set(['rust']) }).verdict, 'INSTALL');
  assert.equal(score(rustCandidate(), { techTags: new Set(['ts']) }).verdict, 'INSTALL');
});
