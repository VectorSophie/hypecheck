import test from 'node:test';
import assert from 'node:assert/strict';
import { renderComparison } from '../src/report.js';

test('compare shows a Labels row and flags which candidate has which label', () => {
  const a = {
    targetName: 'tool-a', verdict: 'INSTALL',
    scores: { workflowFit: 6, redundancy: 1, securityRisk: 2, maintenanceHealth: 8, setupBurden: 2, budgetPressure: 3, overkillIndex: 5 },
    findings: [], labels: ['TOKEN_WIN'],
  };
  const b = {
    targetName: 'tool-b', verdict: 'TRIAL',
    scores: { workflowFit: 5, redundancy: 1, securityRisk: 4, maintenanceHealth: 7, setupBurden: 3, budgetPressure: 4, overkillIndex: 10 },
    findings: [], labels: ['POWERFUL_HOOK'],
  };
  const text = renderComparison(a, b);
  assert.match(text, /\| Labels \| TOKEN_WIN \| POWERFUL_HOOK \|/);
});

test('compare\'s Labels row shows a dash for a candidate with no labels', () => {
  const a = { targetName: 'a', verdict: 'INSTALL', scores: { workflowFit: 6, redundancy: 1, securityRisk: 2, maintenanceHealth: 8, setupBurden: 2, budgetPressure: 3, overkillIndex: 5 }, findings: [], labels: [] };
  const b = { targetName: 'b', verdict: 'INSTALL', scores: { workflowFit: 6, redundancy: 1, securityRisk: 2, maintenanceHealth: 8, setupBurden: 2, budgetPressure: 3, overkillIndex: 5 }, findings: [], labels: [] };
  const text = renderComparison(a, b);
  assert.match(text, /\| Labels \| — \| — \|/);
});
