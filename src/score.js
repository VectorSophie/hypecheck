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
    summary: roast(verdict, analysis.findings),
  };
}

const OPENERS = {
  DANGEROUS: 'Dangerous. This touches sharp objects and acts casual about it',
  SKIP: 'Skip. Mostly install friction with a hat',
  TRIAL: 'Trial only. Useful-looking, but keep it on a short leash',
  REDUNDANT: 'Redundant. You already own this flavor of chaos',
  INSTALL: 'Install. The evidence does not scream at us yet',
};

const NEGATIVE_VERDICTS = new Set(['DANGEROUS', 'SKIP', 'REDUNDANT']);

// Blunt one-liner. For negative verdicts the top finding IS the reason, so lead
// with it. For positive verdicts (INSTALL/TRIAL) a finding is a caveat, not the
// reason — frame it as a watch-out so the line doesn't contradict the verdict.
function roast(verdict, findings) {
  const opener = OPENERS[verdict] ?? OPENERS.INSTALL;
  const top = topFinding(verdict, findings);
  if (!top) return `${opener}.`;
  if (NEGATIVE_VERDICTS.has(verdict)) return `${opener}: ${top.evidence}`;
  const notable = (SEVERITY_WEIGHT[top.severity] ?? 1) >= 2;
  return notable ? `${opener}. Worth a closer look: ${top.evidence}` : `${opener}.`;
}

function topFinding(verdict, findings) {
  if (findings.length === 0) return null;
  // For REDUNDANT, lead with the overlap that earned the verdict.
  const preferred = verdict === 'REDUNDANT' ? 'redundancy' : null;
  const rank = (f) => (SEVERITY_WEIGHT[f.severity] ?? 1) + (f.category === preferred ? 10 : 0);
  return [...findings].sort((a, b) => rank(b) - rank(a))[0];
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
