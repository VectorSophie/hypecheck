import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCandidate } from '../src/analyze.js';
import { scoreAnalysis } from '../src/score.js';
import { renderMarkdownReport } from '../src/report.js';

test('flags lifecycle scripts and shell-execution packages', () => {
  const analysis = analyzeCandidate({
    source: 'npm',
    metadata: {
      name: 'sketchy-agent',
      license: null,
      publishedAt: '2025-01-01T00:00:00Z',
      description: 'Runs agent hooks',
    },
    package: {
      scripts: { postinstall: 'node install.js' },
      dependencies: { execa: '^9.0.0' },
    },
    readme: 'This MCP server can run shell commands and read .env files.',
  }, { now: new Date('2026-06-15T00:00:00Z') });

  assert.equal(analysis.findings.some((finding) => finding.id === 'npm-lifecycle-script'), true);
  assert.equal(analysis.findings.some((finding) => finding.id === 'shell-execution-dependency'), true);
  assert.equal(analysis.findings.some((finding) => finding.id === 'missing-license'), true);
  assert.equal(analysis.findings.some((finding) => finding.id === 'secret-reference'), true);
});

test('flags redundancy when candidate name is already installed', () => {
  const analysis = analyzeCandidate(
    { source: 'npm', metadata: { name: 'prettier', description: 'code formatter' }, readme: '' },
    { localTools: [{ kind: 'dep', name: 'prettier', tags: new Set(['formatting']) }] },
  );
  const finding = analysis.findings.find((f) => f.id === 'redundant-installed');
  assert.ok(finding);
  assert.equal(finding.strength, 'strong');
  assert.match(finding.evidence, /prettier/);
});

test('flags capability redundancy and names the local tool', () => {
  const analysis = analyzeCandidate(
    { source: 'github', metadata: { fullName: 'acme/reviewbot', description: 'automated PR review' }, readme: 'semgrep powered review' },
    { localTools: [{ kind: 'skill', name: 'review', tags: new Set(['code-review']) }] },
  );
  const finding = analysis.findings.find((f) => f.id === 'redundant-capability');
  assert.ok(finding);
  assert.equal(finding.strength, 'strong');
  assert.match(finding.evidence, /review/);
});

test('flags adjacent (weak) redundancy across a capability group', () => {
  const analysis = analyzeCandidate(
    { source: 'npm', metadata: { name: 'eslint', description: 'pluggable linter' }, readme: 'lint your code' },
    { localTools: [{ kind: 'dep', name: 'prettier', tags: new Set(['formatting']) }] },
  );
  const finding = analysis.findings.find((f) => f.id === 'redundant-adjacent');
  assert.ok(finding);
  assert.equal(finding.strength, 'weak');
});

test('reports unique capability when no local overlap', () => {
  const analysis = analyzeCandidate(
    { source: 'npm', metadata: { name: 'pg-tool', description: 'postgres database client' }, readme: '' },
    { localTools: [{ kind: 'dep', name: 'prettier', tags: new Set(['formatting']) }] },
  );
  assert.equal(analysis.findings.some((f) => f.category === 'redundancy'), false);
  assert.equal(analysis.hasUniqueCapability, true);
});

test('maps high risk findings to dangerous verdict', () => {
  const analysis = {
    candidate: { canonical: 'https://www.npmjs.com/package/sketchy-agent' },
    targetName: 'sketchy-agent',
    findings: [
      { severity: 'high', category: 'security', id: 'a', title: 'High risk', evidence: 'Observed shell execution.' },
      { severity: 'high', category: 'security', id: 'b', title: 'High risk', evidence: 'Observed secret access.' },
      { severity: 'medium', category: 'maintenance', id: 'c', title: 'No license', evidence: 'No license found.' },
    ],
  };

  const scored = scoreAnalysis(analysis);

  assert.equal(scored.verdict, 'DANGEROUS');
  assert.equal(scored.scores.securityRisk, 10);
  assert.ok(scored.summary.includes('touches sharp objects'));
});

test('renders markdown report with verdict, scores, and evidence', () => {
  const scored = {
    targetName: 'sketchy-agent',
    verdict: 'SKIP',
    summary: 'Skip. This is mostly install friction with a hat.',
    scores: {
      workflowFit: 4,
      redundancy: 1,
      securityRisk: 7,
      maintenanceHealth: 3,
      setupBurden: 6,
      budgetPressure: 5,
      overkillIndex: 66,
    },
    confidence: 'medium',
    findings: [
      {
        severity: 'high',
        category: 'security',
        id: 'npm-lifecycle-script',
        title: 'Lifecycle script',
        evidence: 'package.json declares postinstall.',
      },
    ],
    unknowns: ['No local Claude Code context was scanned.'],
  };

  const markdown = renderMarkdownReport(scored);

  assert.match(markdown, /Verdict: SKIP/);
  assert.match(markdown, /Security Risk: 7\/10/);
  assert.match(markdown, /package\.json declares postinstall/);
  assert.match(markdown, /No local Claude Code context was scanned/);
});
