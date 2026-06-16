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
  const analysis = analyzeCandidate(data, options);
  if (options.track) applyDrift(candidate, data, analysis, options);
  return scoreAnalysis(analysis);
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

function driftFinding({ addedHooks, addedMcp, versionChanged }, oldVersion, newVersion) {
  const ver = versionChanged ? ` (${oldVersion ?? '?'} -> ${newVersion ?? '?'})` : '';
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
    };
  }
  if (versionChanged) {
    return {
      id: 'drift-detected',
      severity: 'low',
      category: 'maintenance',
      title: 'Version changed since last vetting',
      evidence: `Version changed${ver} with no change to hooks or MCP servers.`,
    };
  }
  return null;
}
