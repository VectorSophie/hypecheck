import { extractPackageSignals, extractHookEvents, extractMcpServers } from './extractors.js';
import { tagCapabilities, matchStrength } from './capabilities.js';

const SHELL_DEPS = new Set(['execa', 'shelljs', 'zx', 'cross-spawn', 'child_process']);
// Hook events that run on tool calls / prompts execute with full user permissions.
const HIGH_RISK_HOOK_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit']);
const SHELL_PIPE = /\|\s*(?:sh|bash|zsh)\b|curl\s+[^|]*\|\s*\w+|base64\s+-d/i;

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

  const hookEvents = extractHookEvents(data.manifests);
  const mcpServers = extractMcpServers(data.manifests);
  analyzeManifests(hookEvents, mcpServers, findings);
  analyzeText(data.readme ?? data.html ?? '', findings, { manifestHooksFound: hookEvents.length > 0 });

  const localTools = options.localTools;
  if (localTools) analyzeCollisions(hookEvents, mcpServers, data.candidateCommands ?? [], localTools, findings);
  const redundancy = analyzeRedundancy(data, targetName, localTools, findings);

  return {
    candidate: data.candidate,
    source: data.source,
    targetName,
    findings,
    hasUniqueCapability: redundancy.hasUniqueCapability,
    scanned: Boolean(localTools),
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
  analyzePackageSignals(data, findings);

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

  // Parity with npm: if the repo's package.json was fetched, run the same
  // lifecycle-script / shell-dependency checks against it.
  if (data.package) {
    analyzePackageSignals(data, findings);
  }

  addStaleFinding(data.metadata?.pushedAt, now, findings);
}

function analyzePackageSignals(data, findings) {
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
      evidence: `Dependencies include shell/process execution package(s): ${shellDeps.join(', ')}.`,
    });
  }
}

// Findings from a repo's actual committed config. Precise > regex: these drive
// the verdict, and demote the README heuristics below to corroboration.
function analyzeManifests(hookEvents, mcpServers, findings) {
  for (const { event, command } of hookEvents) {
    findings.push({
      id: 'configured-hook',
      severity: HIGH_RISK_HOOK_EVENTS.has(event) ? 'high' : 'medium',
      category: 'security',
      title: 'Configured Claude Code hook',
      evidence: `Configures a ${event} hook${command ? ` running \`${truncate(command)}\`` : ''}, which executes with full user permissions.`,
    });
    if (SHELL_PIPE.test(command)) {
      findings.push({
        id: 'shell-in-hook',
        severity: 'high',
        category: 'security',
        title: 'Hook pipes to a shell',
        evidence: `A ${event} hook command pipes to a shell or decodes a payload: \`${truncate(command)}\`.`,
      });
    }
  }

  if (mcpServers.length > 0) {
    const withSecrets = mcpServers.filter((s) => s.needsSecrets).length;
    findings.push({
      id: 'mcp-servers',
      severity: mcpServers.length >= 5 ? 'medium' : 'low',
      category: mcpServers.length >= 5 ? 'workflow' : 'security',
      title: 'Bundles MCP server(s)',
      evidence: `Declares ${mcpServers.length} MCP server(s)${withSecrets ? `, ${withSecrets} requiring credentials` : ''}.`,
    });
  }
}

// Cross-reference the candidate's configured surface against what the user
// already runs locally — "this collides with your workflow."
function analyzeCollisions(candidateHooks, candidateMcp, candidateCommands, localTools, findings) {
  const localHookEvents = localTools.filter((t) => t.kind === 'hook' && t.event);
  const candidateEvents = new Set(candidateHooks.map((h) => h.event));
  for (const event of candidateEvents) {
    const localOnEvent = localHookEvents.filter((t) => t.event === event);
    if (localOnEvent.length > 0) {
      findings.push({
        id: 'hook-event-collision',
        severity: 'medium',
        category: 'workflow',
        title: 'Hook event collision',
        evidence: `Adds a ${event} hook; you already run ${localOnEvent.length} hook(s) on ${event}.`,
      });
    }
  }

  const localMcpNames = new Set(localTools.filter((t) => t.kind === 'mcp').map((t) => t.name));
  for (const server of candidateMcp) {
    if (localMcpNames.has(server.name)) {
      findings.push({
        id: 'mcp-name-collision',
        severity: 'medium',
        category: 'workflow',
        title: 'MCP server name collision',
        evidence: `Registers an MCP server named \`${server.name}\`, which you already have configured locally.`,
      });
    }
  }

  const localCmdNames = new Set(localTools.filter((t) => t.kind === 'command' || t.kind === 'skill').map((t) => t.name));
  for (const name of candidateCommands) {
    if (localCmdNames.has(name)) {
      findings.push({
        id: 'command-name-collision',
        severity: 'medium',
        category: 'workflow',
        title: 'Command/skill name collision',
        evidence: `Ships a command/skill named \`${name}\`, which already exists in your setup.`,
      });
    }
  }
}

function truncate(text, max = 80) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function analyzeText(text, findings, { manifestHooksFound = false } = {}) {
  if (/(?:\.env|\btoken\b|\bsecret\b|\bssh key\b|\bapi key\b)/i.test(text)) {
    findings.push({
      id: 'secret-reference',
      severity: 'low',
      category: 'security',
      title: 'Secret or credential access mentioned',
      evidence: 'README or metadata references secrets, tokens, API keys, SSH keys, or .env files.',
    });
  }

  if (/\b(?:shell command|execute commands?|run commands?|child_process)\b/i.test(text)) {
    findings.push({
      id: 'shell-capability-mentioned',
      severity: manifestHooksFound ? 'low' : 'medium',
      category: 'security',
      title: 'Shell capability mentioned',
      evidence: 'README or metadata mentions running shell commands.',
    });
  }

  // Tool poisoning / prompt injection: model-facing override instructions.
  if (/\b(?:ignore (?:all )?previous instructions|disregard (?:the )?(?:above|prior)|system prompt override|exfiltrat)/i.test(text)) {
    findings.push({
      id: 'prompt-injection-pattern',
      severity: 'high',
      category: 'security',
      title: 'Prompt-injection / tool-poisoning pattern',
      evidence: 'Text contains model-facing override or exfiltration instructions, a known tool-poisoning vector.',
    });
  }

  // Hooks fire with the user's full shell permissions; lifecycle events are the riskiest.
  // Demoted to corroboration when a real hooks manifest was parsed (configured-hook covers it).
  const hookEvent = text.match(/\b(PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|Stop|SubagentStop)\b/);
  if (hookEvent) {
    findings.push({
      id: 'dangerous-hook-event',
      severity: manifestHooksFound ? 'low' : 'high',
      category: 'security',
      title: 'Sensitive hook event',
      evidence: manifestHooksFound
        ? `README mentions a ${hookEvent[1]} hook; see configured-hook findings for the actual config.`
        : `References a ${hookEvent[1]} hook, which runs shell commands with full user permissions.`,
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
