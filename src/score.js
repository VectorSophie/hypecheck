const SEVERITY_WEIGHT = {
  low: 1,
  medium: 2,
  high: 4,
};

export function scoreAnalysis(analysis) {
  const securityPoints = pointsFor(analysis.findings, 'security');
  const maintenancePoints = pointsFor(analysis.findings, 'maintenance');
  const workflowPoints = pointsFor(analysis.findings, 'workflow');
  const setupPoints = analysis.findings.some((finding) => finding.id === 'npm-lifecycle-script') ? 6 : 2;

  const strongOverlaps = analysis.findings.filter((f) => f.category === 'redundancy' && f.strength === 'strong').length;
  const weakOverlaps = analysis.findings.filter((f) => f.category === 'redundancy' && f.strength === 'weak').length;

  const scores = {
    workflowFit: clamp(4 + workflowPoints, 1, 10),
    redundancy: clamp(1 + 3 * strongOverlaps + weakOverlaps, 1, 10),
    securityRisk: clamp(securityPoints + 2, 1, 10),
    maintenanceHealth: clamp(8 - maintenancePoints, 1, 10),
    setupBurden: clamp(setupPoints, 1, 10),
    budgetPressure: clamp(3 + workflowPoints, 1, 10),
    overkillIndex: clamp((securityPoints * 8) + (maintenancePoints * 6) + (setupPoints * 4), 0, 100),
  };

  const verdict = chooseVerdict(scores, analysis.findings, analysis.hasUniqueCapability !== false);

  return {
    ...analysis,
    verdict,
    scores,
    confidence: analysis.findings.length >= 3 ? 'medium' : 'low',
    summary: summaryFor(verdict),
  };
}

function pointsFor(findings, category) {
  return findings
    .filter((finding) => finding.category === category)
    .reduce((sum, finding) => sum + (SEVERITY_WEIGHT[finding.severity] ?? 1), 0);
}

function chooseVerdict(scores, findings, hasUniqueCapability) {
  const highSecurity = findings.filter((finding) => finding.category === 'security' && finding.severity === 'high').length;

  if (highSecurity >= 2 || scores.securityRisk >= 9) return 'DANGEROUS';
  if (scores.redundancy >= 6 && !hasUniqueCapability) return 'REDUNDANT';
  if (scores.overkillIndex >= 70) return 'SKIP';
  if (scores.securityRisk >= 7) return 'TRIAL';
  return 'INSTALL';
}

function summaryFor(verdict) {
  if (verdict === 'DANGEROUS') return 'Dangerous. This touches sharp objects and acts casual about it.';
  if (verdict === 'SKIP') return 'Skip. This is mostly install friction with a hat.';
  if (verdict === 'TRIAL') return 'Trial only. Useful-looking, but keep it on a short leash.';
  if (verdict === 'REDUNDANT') return 'Redundant. You already own this flavor of chaos.';
  return 'Install. The evidence does not scream at us yet.';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
