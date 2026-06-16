// Turns the lens on the user's own installed setup — no candidate involved.
// Reuses scanLocalContext output. The one thing isolated scanners can't do.

const SHELL_PIPE = /\|\s*(?:sh|bash|zsh)\b|curl\s+[^|]*\|\s*\w+|base64\s+-d/i;
const HIGH_RISK_HOOK_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit']);

export function auditSetup(localTools) {
  const findings = [];

  // Redundancy: 2+ local tools sharing a capability family.
  const byTag = new Map();
  for (const tool of localTools) {
    for (const t of tool.tags) {
      if (!byTag.has(t)) byTag.set(t, []);
      byTag.get(t).push(`${tool.kind} \`${tool.name}\``);
    }
  }
  for (const [family, owners] of byTag) {
    if (owners.length >= 2) {
      findings.push({
        id: 'local-redundancy', severity: 'low', category: 'redundancy',
        title: 'Overlapping local tools',
        evidence: `${owners.length} local tools cover ${family}: ${owners.join(', ')}.`,
      });
    }
  }

  // Hook collisions: 2+ local hooks on the same event.
  const byEvent = new Map();
  for (const tool of localTools) {
    if (tool.kind === 'hook' && tool.event) {
      byEvent.set(tool.event, (byEvent.get(tool.event) ?? 0) + 1);
    }
  }
  for (const [event, count] of byEvent) {
    if (count >= 2) {
      findings.push({
        id: 'local-hook-collision', severity: 'medium', category: 'workflow',
        title: 'Multiple hooks on one event',
        evidence: `You run ${count} hooks on ${event}; they all fire, in config order.`,
      });
    }
  }

  // Risky hooks you're already running.
  for (const tool of localTools) {
    if (tool.kind !== 'hook') continue;
    if (SHELL_PIPE.test(tool.command ?? '')) {
      findings.push({
        id: 'local-risky-hook', severity: 'high', category: 'security',
        title: 'Local hook pipes to a shell',
        evidence: `Your ${tool.event ?? '?'} hook runs \`${truncate(tool.command)}\`, which pipes to a shell or decodes a payload.`,
      });
    } else if (HIGH_RISK_HOOK_EVENTS.has(tool.event) && tool.command) {
      findings.push({
        id: 'local-risky-hook', severity: 'medium', category: 'security',
        title: 'Local tool-call hook',
        evidence: `Your ${tool.event} hook runs \`${truncate(tool.command)}\` with full permissions on every tool call.`,
      });
    }
  }

  return findings;
}

function truncate(text, max = 80) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
