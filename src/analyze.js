import { extractPackageSignals, extractHookEvents, extractMcpServers } from './extractors.js';
import { tagCapabilities, matchStrength, classifyOverlap } from './capabilities.js';
import { tagTech } from './profile.js';
import { classifyHook } from './hook-analysis.js';
import { computeTokenEconomics } from './token-economics.js';

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

  const hookEvents = extractHookEvents(data.manifests);
  const mcpServers = extractMcpServers(data.manifests);
  analyzeManifests(hookEvents, mcpServers, data.componentRoot, data.hookScripts, findings);
  analyzeInstructionBombs(data.claudeMdHazards, findings);
  analyzeText(data.readme ?? data.html ?? '', findings, { manifestHooksFound: hookEvents.length > 0 });

  const localTools = options.localTools;
  if (localTools) analyzeCollisions(hookEvents, mcpServers, data.candidateCommands ?? [], localTools, findings);
  const redundancy = analyzeRedundancy(data, targetName, localTools, findings);
  const tokenEconomics = computeTokenEconomics(data, data.discovery);

  const hookLabels = [];
  if (findings.some((f) => f.id === 'hook-dangerous-capability')) hookLabels.push('POWERFUL_HOOK');
  if (findings.some((f) => f.id === 'hook-permission-bypass')) hookLabels.push('HOOK_PERMISSION_BYPASS');

  // Order (token-economics, then overlap, then hook) is arbitrary — these
  // three sources use disjoint vocabularies today, so nothing currently
  // depends on it. Revisit if report.js starts rendering this array in a
  // way where order is user-visible.
  const labels = [...new Set([...tokenEconomics.labels, ...redundancy.overlapLabels, ...hookLabels])];

  return {
    candidate: data.candidate,
    source: data.source,
    targetName,
    findings,
    hasUniqueCapability: redundancy.hasUniqueCapability,
    scanned: Boolean(localTools),
    fit: computeFit(data, targetName, options.userProfile),
    unknowns: redundancy.unknowns,
    tokenEconomics,
    labels,
  };
}

// Stack fit: does the candidate target a stack the user actually works in?
// A weak, advisory signal — never a verdict driver (chooseVerdict ignores it).
function computeFit(data, targetName, userProfile) {
  const userTech = userProfile?.techTags;
  if (!userTech || userTech.size === 0) return { signal: 'none' };

  const candidateText = `${targetName} ${data.metadata?.language ?? ''} ${data.metadata?.description ?? ''} ${data.readme ?? data.html ?? ''}`;
  const candidateTech = tagTech(candidateText);
  if (candidateTech.size === 0) return { signal: 'none' };

  const matched = [...candidateTech].filter((t) => userTech.has(t));
  if (matched.length > 0) return { signal: 'match', tags: matched };
  return { signal: 'mismatch', tags: [...candidateTech] };
}

function analyzeRedundancy(data, targetName, localTools, findings) {
  if (!localTools) {
    return { hasUniqueCapability: true, unknowns: ['Local Claude Code context was not scanned.'], overlapLabels: [] };
  }

  const bareName = String(targetName).split('/').pop();
  const candidateText = `${targetName} ${data.metadata?.description ?? ''} ${data.readme ?? data.html ?? ''}`;
  const candidateTags = tagCapabilities(candidateText);

  let covered = false;
  const overlapLabels = new Set();
  for (const tag of candidateTags) {
    if (localTools.some((tool) => tool.tags.has(tag))) covered = true;
  }

  for (const tool of localTools) {
    if (tool.name === targetName || tool.name === bareName) {
      // Exact name match is the strongest duplication signal there is —
      // stronger than tag-set comparison. Real README/description text is
      // noisy and picks up many incidental capability tags a short local-tool
      // description won't replicate, so classifyOverlap's set-equality check
      // for 'exact-duplicate' rarely fires here in practice even though this
      // IS the textbook exact-duplicate case. Force the label directly rather
      // than relying on tag-set equality to happen to hold.
      overlapLabels.add('EXACT_DUPLICATE');
      findings.push(redundantFinding('redundant-installed', 'strong', tool,
        `Already installed locally as ${tool.kind} \`${tool.name}\`.`));
      continue;
    }

    const overlap = classifyOverlap(candidateTags, tool.tags);
    if (overlap === 'exact-duplicate') overlapLabels.add('EXACT_DUPLICATE');
    else if (overlap === 'strong-overlap' || overlap === 'adjacent') overlapLabels.add('CAPABILITY_OVERLAP');

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
    overlapLabels: [...overlapLabels],
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
    provenance: 'local-config',
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
      provenance: 'package-metadata',
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
      provenance: 'package-metadata',
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
      provenance: 'manifest',
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
      provenance: 'manifest',
    });
  }
}

// Findings from a repo's actual committed config. Precise > regex: these drive
// the verdict, and demote the README heuristics below to corroboration.
function analyzeManifests(hookEvents, mcpServers, componentRoot, hookScripts, findings) {
  for (const hookEntry of hookEvents) {
    const capability = classifyHook(hookEntry, componentRoot ?? '', hookScripts ?? {});
    findings.push(hookFinding(capability));
  }

  if (mcpServers.length > 0) {
    const withSecrets = mcpServers.filter((s) => s.needsSecrets).length;
    findings.push({
      id: 'mcp-servers',
      severity: mcpServers.length >= 5 ? 'medium' : 'low',
      category: mcpServers.length >= 5 ? 'workflow' : 'security',
      title: 'Bundles MCP server(s)',
      evidence: `Declares ${mcpServers.length} MCP server(s)${withSecrets ? `, ${withSecrets} requiring credentials` : ''}.`,
      provenance: 'manifest',
    });
  }
}

// Candidate-repo instruction bombs: discovery.js already classifies nested
// CLAUDE.md files under fixtures/tests/malicious-style paths (see its
// ADVERSARIAL_DIR_KEYWORDS, shared with audit-analyze.js's own local-project
// check from Phase 4) — this turns that already-computed classification into
// an actual finding, which nothing did before this function existed.
//
// KNOWN LIMITATION: one finding fires per hazard PATH, unbounded — a
// legitimate security-research repo with 2+ committed test fixtures
// matching the adversarial-directory keywords will cross score.js's
// `highSecurity >= 2` DANGEROUS threshold from this feature alone, with no
// other corroborating signal. Unlike audit-analyze.js's local-project
// version of this check, a .gitignore exclusion can't help here — discovery.js
// only ever sees paths already present in the committed git tree via the
// GitHub API, so a gitignored file would never reach `claudeMdHazards` in
// the first place. Accepted for now: severity stays unconditionally 'high'
// per finding (matching the local-project version's own calibration), and
// deduping same-source findings before the DANGEROUS threshold is a
// score.js-wide question, not something to special-case for this one
// finding id (see CLAUDE.md's "don't special-case verdicts elsewhere").
function analyzeInstructionBombs(hazards, findings) {
  for (const filePath of hazards ?? []) {
    findings.push({
      id: 'candidate-instruction-bomb',
      severity: 'high',
      category: 'security',
      title: 'Adversarial-looking nested CLAUDE.md in candidate repo',
      evidence: `${filePath} sits under a fixtures/tests/malicious-style directory in this repo. Claude Code loads nested CLAUDE.md files on demand — if you explore this path (e.g. while reviewing the candidate yourself), it can become live agent instructions.`,
      // 'inferred', not 'manifest': this comes from discovery.js classifying
      // a file PATH by name pattern, not from parsing hooks.json/plugin.json/
      // mcp.json/package.json content — no config file was actually read to
      // produce this finding. Labeling it 'manifest' would let score.js's
      // confidence calc treat a directory-naming coincidence as the same
      // strength of evidence as an actually-parsed manifest, compounding the
      // multi-hazard/DANGEROUS risk already noted above.
      provenance: 'inferred',
    });
  }
}

const HIGH_RISK_HOOK_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit']);

// Translates one hook's capability struct into exactly one finding.
// Priority: observed dangerous capability > permission bypass > unverified
// powerful > benign/bounded. A hook can only be "dangerous" or
// "permission-bypass" (high severity, gates DANGEROUS) via ACTUALLY OBSERVED
// evidence — either inspected source, or a pattern visible in the command
// line itself (e.g. curl|sh). An uninspected, otherwise-unremarkable command
// on a high-risk event is "unverified" (medium), never automatically high —
// this is the fix for "PreToolUse ⇒ scary" collapsing every hook into one
// bucket regardless of what it actually does.
function hookFinding(capability) {
  const { event, command } = capability;
  const provenance = capability.sourceInspected ? 'source' : 'manifest';
  // filesystemWrite/filesystemRead are deliberately excluded here: writing a
  // log/cache file is extremely common and not inherently dangerous, and the
  // static regexes can't distinguish a fixed path from an attacker-influenced
  // one. Tracked as data on the capability struct, not severity-gating.
  const dangerousCapability = capability.execsShell || capability.network || capability.credentialAccess
    || capability.destructive || capability.pipesDownloadToShell || capability.gitMutation || capability.deployMutation;

  if (dangerousCapability) {
    const matched = [];
    if (capability.execsShell) matched.push('shell execution');
    if (capability.network) matched.push('network access');
    if (capability.credentialAccess) matched.push('credential access');
    if (capability.destructive) matched.push('a destructive command');
    if (capability.pipesDownloadToShell) matched.push('a download piped to a shell');
    if (capability.gitMutation) matched.push('a git mutation (push/commit/reset --hard/checkout -f)');
    if (capability.deployMutation) matched.push('a deployment mutation');

    return {
      id: 'hook-dangerous-capability',
      severity: 'high',
      category: 'security',
      title: 'Hook has an observed dangerous capability',
      evidence: `A ${event} hook (\`${truncate(command)}\`) ${capability.sourceInspected ? 'was inspected and shows' : 'shows'} ${matched.join(', ')}.`,
      provenance,
    };
  }

  if (capability.autoAllows) {
    return {
      id: 'hook-permission-bypass',
      severity: 'high',
      category: 'security',
      title: 'Hook auto-allows permission, bypassing the normal prompt',
      evidence: `A ${event} hook (\`${truncate(command)}\`) returns \`permissionDecision: "allow"\`, bypassing Claude's normal permission flow.`,
      provenance,
    };
  }

  if (!capability.sourceInspected && HIGH_RISK_HOOK_EVENTS.has(event)) {
    return {
      id: 'hook-unverified-powerful',
      severity: 'medium',
      category: 'security',
      title: 'Unverified hook on a high-impact event',
      evidence: `A ${event} hook (\`${truncate(command)}\`) runs with full user permissions on every matching tool call; its source could not be inspected, so its actual behavior is unverified.`,
      provenance,
    };
  }

  return {
    id: 'hook-benign-bounded',
    severity: 'low',
    category: 'security',
    title: capability.sourceInspected ? 'Hook inspected, no dangerous capability found' : 'Hook not inspected, no dangerous pattern visible in the command',
    evidence: `A ${event} hook (\`${truncate(command)}\`)${capability.sourceInspected ? ' was inspected and shows' : ' shows'} no shell execution, network access, credential access, or destructive capability.`,
    provenance,
  };
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
        provenance: 'local-config',
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
        provenance: 'local-config',
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
        provenance: 'local-config',
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
      provenance: 'readme',
    });
  }

  if (/\b(?:shell command|execute commands?|run commands?|child_process)\b/i.test(text)) {
    findings.push({
      id: 'shell-capability-mentioned',
      severity: manifestHooksFound ? 'low' : 'medium',
      category: 'security',
      title: 'Shell capability mentioned',
      evidence: 'README or metadata mentions running shell commands.',
      provenance: 'readme',
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
      provenance: 'readme',
    });
  }

  // Hooks fire with the user's full shell permissions; lifecycle events are the riskiest.
  // Demoted to corroboration when a real hooks manifest was parsed (the hook-* findings cover it).
  const hookEvent = text.match(/\b(PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|Stop|SubagentStop)\b/);
  if (hookEvent) {
    findings.push({
      id: 'dangerous-hook-event',
      severity: manifestHooksFound ? 'low' : 'high',
      category: 'security',
      title: 'Sensitive hook event',
      evidence: manifestHooksFound
        ? `README mentions a ${hookEvent[1]} hook; see the hook-* findings above for the actual configured behavior.`
        : `References a ${hookEvent[1]} hook, which runs shell commands with full user permissions.`,
      provenance: 'readme',
    });
  }

  if (/\b(?:mcp server|claude code|hook|slash command|agent)\b/i.test(text)) {
    findings.push({
      id: 'agent-tooling-scope',
      severity: 'low',
      category: 'workflow',
      title: 'Agent tooling candidate',
      evidence: 'README or metadata indicates this affects Claude Code, MCP, hooks, slash commands, or agents.',
      provenance: 'readme',
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
      provenance: 'package-metadata',
    });
  }
}
