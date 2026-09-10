import { normalizeCandidate } from './candidate.js';
import { fetchCandidateData } from './fetchers.js';
import { extractCandidateLinks } from './extractors.js';
import { analyzeCandidate } from './analyze.js';
import { scoreAnalysis } from './score.js';
import { computeFingerprint, diffFingerprint, readRecord, writeRecord } from './cache.js';

export async function evaluateCandidate(input, options = {}) {
  const candidate = normalizeCandidate(input);

  if (candidate.type === 'social') {
    const socialData = await fetchCandidateData(candidate, options);
    const links = extractCandidateLinks(socialData.html);
    if (links.length === 0) {
      throw new Error('No GitHub or npm candidate link found in social URL');
    }
    return evaluateCandidate(links[0], options);
  }

  const data = await fetchCandidateData(candidate, options);

  if (data.components && data.components.length > 1) {
    return evaluateMultiComponent(data, options);
  }

  const analysis = analyzeCandidate(data, options);
  if (options.track) applyDrift(candidate, data, analysis, options);
  return scoreAnalysis(analysis);
}

// Marketplace/monorepo with 2+ materially distinct components: no single
// verdict describes the whole repo, so evaluate and score each separately.
//
// KNOWN LIMITATION: each component's analysis still reads the repo-level
// `readme`/`package`/`metadata` (only `manifests`/`candidateCommands` are
// swapped per-component), so README-text-based and package.json-based
// findings are currently identical across every component in a marketplace,
// even though each component's own manifests are correctly separated. A
// full fix needs discovery.js to capture per-component README/package.json,
// which it doesn't today (only manifest/hook/mcp/skill/command files are
// classified as "interesting"). Tracked as a fast-follow, not fixed here.
//
// KNOWN LIMITATION: `options.track` (the `--track` CLI flag) is silently
// ignored here — `applyDrift` is only ever called from the single-component
// path in `evaluateCandidate`. Running `--track` against a multi-component
// candidate produces a rollup with no drift detection and no cache write,
// with no error or warning to the user.
function evaluateMultiComponent(data, options) {
  const allComponentPaths = data.components.map((c) => c.path);

  const components = data.components.map((component) => {
    const componentData = {
      ...data,
      manifests: component.manifests,
      candidateCommands: component.commands,
      hookScripts: component.hookScripts ?? {},
      componentRoot: component.path,
      claudeMdHazards: component.claudeMdHazards ?? [],
      discovery: scopeDiscoveryToComponent(data.discovery, component.path, allComponentPaths),
      components: undefined,
    };
    const analysis = analyzeCandidate(componentData, options);
    const scored = scoreAnalysis(analysis);
    return { path: component.path || '(root)', ...scored };
  });

  return {
    multiComponent: true,
    targetName: data.metadata?.fullName ?? data.candidate?.canonical ?? 'candidate',
    componentCount: components.length,
    components,
    discovery: data.discovery,
  };
}

// Scopes discovery's repo-wide scanned/skipped path lists down to just the
// paths that belong to ONE component, so Phase 3's benchmark-directory
// detection (and any other future discovery-derived signal) doesn't leak
// evidence from one marketplace plugin into an unrelated sibling. Mirrors
// discovery.js's own "most specific root wins" component-assignment logic:
// a non-root component owns paths under its own prefix; the root component
// owns everything NOT claimed by a more specific sibling.
function scopeDiscoveryToComponent(discovery, componentPath, allComponentPaths) {
  if (!discovery) return discovery;

  const isOwnedByThisComponent = (path) => {
    if (componentPath) return path === componentPath || path.startsWith(`${componentPath}/`);
    return !allComponentPaths.some((p) => p && (path === p || path.startsWith(`${p}/`)));
  };

  return {
    ...discovery,
    scanned: (discovery.scanned ?? []).filter(isOwnedByThisComponent),
    skipped: (discovery.skipped ?? []).filter((s) => isOwnedByThisComponent(s.path)),
  };
}

// Opt-in: compare the candidate's current surface against the last --track eval,
// flag changes (rug-pull), then update the baseline.
function applyDrift(candidate, data, analysis, options) {
  const cacheOpts = { cacheDir: options.cacheDir, fsImpl: options.fsImpl };
  const current = computeFingerprint(data);
  const prior = readRecord(candidate.canonical, cacheOpts);
  if (prior?.fingerprint) {
    const finding = driftFinding(diffFingerprint(prior.fingerprint, current), prior.version, current.version);
    if (finding) analysis.findings.push(finding);
  }
  writeRecord(candidate.canonical, { date: new Date().toISOString(), version: current.version, fingerprint: current }, cacheOpts);
}

function driftFinding({ addedHooks, addedMcp, addedMaintainers = [], removedMaintainers = [], versionChanged }, oldVersion, newVersion) {
  const ver = versionChanged ? ` (${oldVersion ?? '?'} -> ${newVersion ?? '?'})` : '';
  if (addedMaintainers.length || removedMaintainers.length) {
    const parts = [];
    if (addedMaintainers.length) parts.push(`added ${addedMaintainers.join(', ')}`);
    if (removedMaintainers.length) parts.push(`removed ${removedMaintainers.join(', ')}`);
    return {
      id: 'maintainer-change',
      severity: 'high',
      category: 'security',
      title: 'Package maintainers changed since last vetting',
      evidence: `Maintainers changed${ver}: ${parts.join('; ')}. A common rug-pull precursor — re-review before trusting.`,
      provenance: 'package-metadata',
    };
  }
  if (addedHooks.length || addedMcp.length) {
    const parts = [
      ...addedHooks.map((h) => `hook ${h.split(':')[0]}`),
      ...addedMcp.map((m) => `MCP server \`${m}\``),
    ];
    return {
      id: 'drift-detected',
      severity: 'high',
      category: 'security',
      title: 'Executable surface changed since last vetting',
      evidence: `Added since you last checked${ver}: ${parts.join(', ')}. Possible rug-pull — re-review before trusting.`,
      provenance: 'manifest',
    };
  }
  if (versionChanged) {
    return {
      id: 'drift-detected',
      severity: 'low',
      category: 'maintenance',
      title: 'Version changed since last vetting',
      evidence: `Version changed${ver} with no change to hooks or MCP servers.`,
      provenance: 'manifest',
    };
  }
  return null;
}
