export function renderMarkdownReport(report) {
  const lines = [
    `# Hypecheck: ${report.targetName ?? 'candidate'}`,
    '',
    `Verdict: ${report.verdict}`,
    '',
    report.summary,
    '',
    ...(report.scanned ? [report.hasUniqueCapability
      ? 'Fit: adds capability your current setup does not obviously cover.'
      : 'Fit: overlaps tools you already run — little net-new capability.', '']
      : []),
    ...stackFitLines(report.fit),
    '## Scores',
    '',
    `- Workflow Fit: ${report.scores.workflowFit}/10`,
    `- Redundancy: ${report.scores.redundancy}/10`,
    `- Security Risk: ${report.scores.securityRisk}/10`,
    `- Maintenance Health: ${report.scores.maintenanceHealth}/10`,
    `- Setup Burden: ${report.scores.setupBurden}/10`,
    `- Budget/Context Pressure: ${report.scores.budgetPressure}/10`,
    `- Overkill Index: ${report.scores.overkillIndex}/100`,
    '',
    `Confidence: ${report.confidence}`,
    '',
    '## Evidence',
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('- No concrete risk findings from the inspected metadata.');
  } else {
    for (const finding of report.findings) {
      lines.push(`- [${finding.severity.toUpperCase()}] ${finding.title}: ${finding.evidence}`);
    }
  }

  if (report.unknowns?.length) {
    lines.push('', '## Could Not Verify', '');
    for (const unknown of report.unknowns) {
      lines.push(`- ${unknown}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

// Advisory stack-fit note (weak signal): only shown when the profile produced one.
function stackFitLines(fit) {
  if (!fit || fit.signal === 'none') return [];
  const tags = (fit.tags ?? []).join(', ');
  if (fit.signal === 'match') return [`Stack fit: matches your ${tags} setup.`, ''];
  return [`Stack fit: targets ${tags}, which your setup doesn't show.`, ''];
}

const SCORE_ROWS = [
  ['Workflow Fit', 'workflowFit'], ['Redundancy', 'redundancy'], ['Security Risk', 'securityRisk'],
  ['Maintenance Health', 'maintenanceHealth'], ['Setup Burden', 'setupBurden'], ['Budget/Context', 'budgetPressure'],
];

export function renderAudit(findings) {
  const lines = ['# Hypecheck audit: your installed setup', ''];
  if (findings.length === 0) {
    lines.push('No redundancy, hook collisions, or risky hooks found in your local config.');
  } else {
    for (const f of findings) {
      lines.push(`- [${f.severity.toUpperCase()}] ${f.title}: ${f.evidence}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function renderComparison(a, b) {
  const lines = [
    `# Hypecheck compare: ${a.targetName} vs ${b.targetName}`,
    '',
    `| | ${a.targetName} | ${b.targetName} |`,
    '| --- | --- | --- |',
    `| Verdict | ${a.verdict} | ${b.verdict} |`,
    ...SCORE_ROWS.map(([label, key]) => `| ${label} | ${a.scores[key]}/10 | ${b.scores[key]}/10 |`),
    `| Overkill | ${a.scores.overkillIndex}/100 | ${b.scores.overkillIndex}/100 |`,
    '',
  ];

  const idsOf = (r) => new Set(r.findings.map((f) => f.id));
  const aIds = idsOf(a);
  const bIds = idsOf(b);
  const uniq = (r, otherIds) => r.findings.filter((f) => !otherIds.has(f.id));

  for (const [name, report, other] of [[a.targetName, a, bIds], [b.targetName, b, aIds]]) {
    const only = uniq(report, other);
    lines.push(`## Only in ${name}`, '');
    lines.push(only.length ? only.map((f) => `- [${f.severity.toUpperCase()}] ${f.title}: ${f.evidence}`).join('\n') : '- (nothing unique)');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
