export function renderMarkdownReport(report) {
  const lines = [
    `# Hypecheck: ${report.targetName ?? 'candidate'}`,
    '',
    `Verdict: ${report.verdict}`,
    '',
    report.summary,
    '',
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
