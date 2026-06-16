import { extractPackageSignals } from './extractors.js';
import { tagCapabilities, matchStrength } from './capabilities.js';

const SHELL_DEPS = new Set(['execa', 'shelljs', 'zx', 'cross-spawn', 'child_process']);

export function analyzeCandidate(data, options = {}) {
  const now = options.now ?? new Date();
  const findings = [];
  const targetName = data.metadata?.name ?? data.metadata?.fullName ?? data.candidate?.canonical ?? 'candidate';

  if (data.source === 'npm') {
    analyzeNpm(data, findings, now);
  }

  if (data.source === 'github') {
    analyzeGithub(data, findings, now);
  }

  analyzeText(data.readme ?? data.html ?? '', findings);

  const localTools = options.localTools;
  const redundancy = analyzeRedundancy(data, targetName, localTools, findings);

  return {
    candidate: data.candidate,
    source: data.source,
    targetName,
    findings,
    hasUniqueCapability: redundancy.hasUniqueCapability,
    unknowns: redundancy.unknowns,
  };
}

function analyzeRedundancy(data, targetName, localTools, findings) {
  if (!localTools) {
    return { hasUniqueCapability: true, unknowns: ['Local Claude Code context was not scanned.'] };
  }

  const bareName = String(targetName).split('/').pop();
  const candidateText = `${targetName} ${data.metadata?.description ?? ''} ${data.readme ?? data.html ?? ''}`;
  const candidateTags = tagCapabilities(candidateText);

  let covered = false;
  for (const tag of candidateTags) {
    if (localTools.some((tool) => tool.tags.has(tag))) covered = true;
  }

  for (const tool of localTools) {
    if (tool.name === targetName || tool.name === bareName) {
      findings.push(redundantFinding('redundant-installed', 'strong', tool,
        `Already installed locally as ${tool.kind} \`${tool.name}\`.`));
      continue;
    }
    const strength = matchStrength(candidateTags, tool.tags);
    if (strength === 'strong') {
      findings.push(redundantFinding('redundant-capability', 'strong', tool,
        `Overlaps with your existing ${tool.kind} \`${tool.name}\`.`));
    } else if (strength === 'weak') {
      findings.push(redundantFinding('redundant-adjacent', 'weak', tool,
        `Adjacent to your existing ${tool.kind} \`${tool.name}\`.`));
    }
  }

  // Unique value: at least one candidate capability no local tool covers,
  // or the candidate has no detectable capability overlap at all.
  const hasUniqueCapability = candidateTags.size === 0 ? true : !covered;

  return {
    hasUniqueCapability,
    unknowns: [`Scanned local context: ${localTools.length} known tool(s). Tool behavior not inspected.`],
  };
}

function redundantFinding(id, strength, tool, evidence) {
  return {
    id,
    strength,
    severity: strength === 'strong' ? 'medium' : 'low',
    category: 'redundancy',
    title: 'Capability already covered locally',
    evidence,
  };
}

function analyzeNpm(data, findings, now) {
  const signals = extractPackageSignals(data);

  if (signals.lifecycleScripts.length > 0) {
    findings.push({
      id: 'npm-lifecycle-script',
      severity: 'high',
      category: 'security',
      title: 'Package lifecycle script',
      evidence: `package.json declares lifecycle script(s): ${signals.lifecycleScripts.join(', ')}.`,
    });
  }

  const shellDeps = signals.dependencies.filter((dep) => SHELL_DEPS.has(dep));
  if (shellDeps.length > 0) {
    findings.push({
      id: 'shell-execution-dependency',
      severity: 'high',
      category: 'security',
      title: 'Shell execution dependency',
      evidence: `Runtime dependencies include shell/process execution package(s): ${shellDeps.join(', ')}.`,
    });
  }

  if (!data.metadata?.license) {
    findings.push({
      id: 'missing-license',
      severity: 'medium',
      category: 'maintenance',
      title: 'Missing license',
      evidence: 'No package license was found in registry metadata.',
    });
  }

  addStaleFinding(data.metadata?.publishedAt, now, findings);
}

function analyzeGithub(data, findings, now) {
  if (!data.metadata?.license) {
    findings.push({
      id: 'missing-license',
      severity: 'medium',
      category: 'maintenance',
      title: 'Missing license',
      evidence: 'No repository license was found in GitHub metadata.',
    });
  }

  addStaleFinding(data.metadata?.pushedAt, now, findings);
}

function analyzeText(text, findings) {
  if (/(?:\.env|\btoken\b|\bsecret\b|\bssh key\b|\bapi key\b)/i.test(text)) {
    findings.push({
      id: 'secret-reference',
      severity: 'high',
      category: 'security',
      title: 'Secret or credential access mentioned',
      evidence: 'README or metadata references secrets, tokens, API keys, SSH keys, or .env files.',
    });
  }

  if (/\b(?:shell command|execute commands?|run commands?|child_process)\b/i.test(text)) {
    findings.push({
      id: 'shell-capability-mentioned',
      severity: 'medium',
      category: 'security',
      title: 'Shell capability mentioned',
      evidence: 'README or metadata mentions running shell commands.',
    });
  }

  if (/\b(?:mcp server|claude code|hook|slash command|agent)\b/i.test(text)) {
    findings.push({
      id: 'agent-tooling-scope',
      severity: 'low',
      category: 'workflow',
      title: 'Agent tooling candidate',
      evidence: 'README or metadata indicates this affects Claude Code, MCP, hooks, slash commands, or agents.',
    });
  }
}

function addStaleFinding(dateValue, now, findings) {
  if (!dateValue) return;

  const ageDays = Math.floor((now.getTime() - new Date(dateValue).getTime()) / 86_400_000);
  if (ageDays > 365) {
    findings.push({
      id: 'stale-maintenance',
      severity: 'medium',
      category: 'maintenance',
      title: 'Stale maintenance signal',
      evidence: `Latest observed activity is ${ageDays} days old.`,
    });
  }
}
