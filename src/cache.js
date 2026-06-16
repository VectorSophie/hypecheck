import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractHookEvents, extractMcpServers } from './extractors.js';

// Opt-in eval cache for drift detection. Stores only the candidate's own public
// surface (hook events + commands, MCP server names, version) — never user config
// or secrets. Local-only; nothing is sent anywhere.

const defaultDir = () => path.join(os.homedir(), '.hypecheck', 'evals');

function recordPath(canonical, dir) {
  return path.join(dir, `${createHash('sha256').update(canonical).digest('hex')}.json`);
}

export function computeFingerprint(data) {
  return {
    hooks: extractHookEvents(data.manifests).map((h) => `${h.event}:${h.command}`).sort(),
    mcp: extractMcpServers(data.manifests).map((s) => s.name).sort(),
    version: data.metadata?.latestVersion ?? data.metadata?.version ?? null,
  };
}

export function diffFingerprint(prior, current) {
  const added = (a, b) => b.filter((x) => !a.includes(x));
  return {
    addedHooks: added(prior.hooks ?? [], current.hooks ?? []),
    addedMcp: added(prior.mcp ?? [], current.mcp ?? []),
    versionChanged: prior.version !== current.version,
  };
}

export function readRecord(canonical, { cacheDir = defaultDir(), fsImpl = nodeFs } = {}) {
  try {
    return JSON.parse(fsImpl.readFileSync(recordPath(canonical, cacheDir)));
  } catch {
    return null;
  }
}

export function writeRecord(canonical, record, { cacheDir = defaultDir(), fsImpl = nodeFs } = {}) {
  try {
    fsImpl.mkdirSync(cacheDir, { recursive: true });
    fsImpl.writeFileSync(recordPath(canonical, cacheDir), JSON.stringify(record));
  } catch { /* cache is best-effort; never fail an eval over it */ }
}
