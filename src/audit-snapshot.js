import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mirrors src/cache.js's readRecord/writeRecord persistence convention
// (home-relative dir, injectable fs, best-effort/never-throws) — diverges
// intentionally in two ways: `name` stays human-readable rather than
// hashed (unlike cache.js's SHA-256'd `canonical`, since the whole point
// of a snapshot name is that the user chose it and wants to refer back to
// it), and writeSnapshot returns a success boolean since the CLI needs to
// report a failed --snapshot/--diff back to the user.
const defaultDir = () => path.join(os.homedir(), '.hypecheck', 'audits');

// `name` comes straight from `hypecheck audit --snapshot <name>`/`--diff
// <name>` — user-controlled CLI input. Because it stays human-readable
// (not hashed, see above), it must be allowlisted before ever reaching
// path.join: an unvalidated `../../etc/whatever` would let a snapshot
// write land outside ~/.hypecheck/audits/.
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

function snapshotPath(name, dir) {
  return path.join(dir, `${name}.json`);
}

export function readSnapshot(name, { snapshotDir = defaultDir(), fsImpl = nodeFs } = {}) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name)) return null;
  try {
    return JSON.parse(fsImpl.readFileSync(snapshotPath(name, snapshotDir)));
  } catch {
    return null;
  }
}

export function writeSnapshot(name, data, { snapshotDir = defaultDir(), fsImpl = nodeFs } = {}) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name)) return false;
  try {
    fsImpl.mkdirSync(snapshotDir, { recursive: true });
    fsImpl.writeFileSync(snapshotPath(name, snapshotDir), JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}
