import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFingerprint, diffFingerprint, readRecord, writeRecord } from '../src/cache.js';

function memFs() {
  const files = new Map();
  return {
    files,
    readFileSync: (p) => { if (files.has(p)) return files.get(p); throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    writeFileSync: (p, d) => files.set(p, d),
    mkdirSync: () => {},
  };
}

const ghData = (manifests, version) => ({ candidate: { canonical: 'https://github.com/o/r' }, metadata: { latestVersion: version }, manifests });

test('computeFingerprint captures hook events, mcp names, and version', () => {
  const fp = computeFingerprint(ghData({ plugin: null, hooks: { hooks: { PostToolUse: [{ hooks: [{ command: 'x' }] }] } }, mcp: { mcpServers: { db: {} } } }, '1.0.0'));
  assert.deepEqual(fp.hooks, ['PostToolUse:x']);
  assert.deepEqual(fp.mcp, ['db']);
  assert.equal(fp.version, '1.0.0');
});

test('diffFingerprint detects added hooks and mcp servers', () => {
  const prior = { hooks: [], mcp: [], version: '1.0.0' };
  const current = { hooks: ['PostToolUse:x'], mcp: ['db'], version: '2.0.0' };
  const diff = diffFingerprint(prior, current);
  assert.deepEqual(diff.addedHooks, ['PostToolUse:x']);
  assert.deepEqual(diff.addedMcp, ['db']);
  assert.equal(diff.versionChanged, true);
});

test('record write/read round-trips through injected fs', () => {
  const fs = memFs();
  const opts = { cacheDir: '/cache', fsImpl: fs };
  assert.equal(readRecord('https://github.com/o/r', opts), null);
  writeRecord('https://github.com/o/r', { date: 'd', version: '1.0.0', fingerprint: { hooks: [], mcp: [], version: '1.0.0' } }, opts);
  assert.equal(readRecord('https://github.com/o/r', opts).version, '1.0.0');
});
