import test from 'node:test';
import assert from 'node:assert/strict';
import { readSnapshot, writeSnapshot } from '../src/audit-snapshot.js';

test('writeSnapshot then readSnapshot round-trips the data', () => {
  const files = new Map();
  const fsImpl = {
    mkdirSync: () => {},
    writeFileSync: (p, data) => files.set(p, data),
    readFileSync: (p) => { if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return files.get(p); },
  };
  writeSnapshot('before', { claudeCli: { version: '1.0.0' } }, { snapshotDir: '/snap', fsImpl });
  const result = readSnapshot('before', { snapshotDir: '/snap', fsImpl });
  assert.equal(result.claudeCli.version, '1.0.0');
});

test('readSnapshot returns null for a missing snapshot', () => {
  const fsImpl = { readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } };
  assert.equal(readSnapshot('missing', { snapshotDir: '/snap', fsImpl }), null);
});

test('writeSnapshot never throws on a filesystem error', () => {
  const fsImpl = { mkdirSync: () => { throw new Error('disk full'); }, writeFileSync: () => {} };
  assert.equal(writeSnapshot('x', {}, { snapshotDir: '/snap', fsImpl }), false);
});
