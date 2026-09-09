import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mirrors src/cache.js's readRecord/writeRecord pattern exactly — home-
// relative, {snapshotDir, fsImpl} injectable, best-effort (never throws).
const defaultDir = () => path.join(os.homedir(), '.hypecheck', 'audits');

function snapshotPath(name, dir) {
  return path.join(dir, `${name}.json`);
}

export function readSnapshot(name, { snapshotDir = defaultDir(), fsImpl = nodeFs } = {}) {
  try {
    return JSON.parse(fsImpl.readFileSync(snapshotPath(name, snapshotDir)));
  } catch {
    return null;
  }
}

export function writeSnapshot(name, data, { snapshotDir = defaultDir(), fsImpl = nodeFs } = {}) {
  try {
    fsImpl.mkdirSync(snapshotDir, { recursive: true });
    fsImpl.writeFileSync(snapshotPath(name, snapshotDir), JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}
