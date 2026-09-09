import test from 'node:test';
import assert from 'node:assert/strict';
import { readSnapshot, writeSnapshot, diffSnapshots } from '../src/audit-snapshot.js';

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

test('rejects a path-traversal snapshot name instead of writing outside snapshotDir', () => {
  const writes = [];
  const fsImpl = {
    mkdirSync: () => {},
    writeFileSync: (p) => writes.push(p),
    readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  };
  assert.equal(writeSnapshot('../../etc/whatever', {}, { snapshotDir: '/snap', fsImpl }), false);
  assert.deepEqual(writes, []);
  assert.equal(readSnapshot('../../etc/whatever', { snapshotDir: '/snap', fsImpl }), null);
});

test('rejects a non-string snapshot name rather than stringifying it into a path', () => {
  const fsImpl = { mkdirSync: () => {}, writeFileSync: () => { throw new Error('should not be called'); } };
  assert.equal(writeSnapshot(undefined, {}, { snapshotDir: '/snap', fsImpl }), false);
  assert.equal(readSnapshot(undefined, { snapshotDir: '/snap', fsImpl }), null);
});

test('diffSnapshots reports added and removed plugins', () => {
  const before = { plugins: { list: [{ name: 'a' }] }, claudeCli: { version: '1.0.0' } };
  const after = { plugins: { list: [{ name: 'a' }, { name: 'b' }] }, claudeCli: { version: '1.0.0' } };
  const diff = diffSnapshots(before, after);
  assert.deepEqual(diff.addedPlugins, ['b']);
  assert.deepEqual(diff.removedPlugins, []);
});

test('diffSnapshots reports added and removed MCP servers', () => {
  const before = { configFiles: { projectMcp: { mcpServers: { db: {} } } } };
  const after = { configFiles: { projectMcp: { mcpServers: { cache: {} } } } };
  const diff = diffSnapshots(before, after);
  assert.deepEqual(diff.addedMcp, ['cache']);
  assert.deepEqual(diff.removedMcp, ['db']);
});

test('diffSnapshots reports a claude CLI version change', () => {
  const diff = diffSnapshots({ claudeCli: { version: '1.0.0' } }, { claudeCli: { version: '1.1.0' } });
  assert.equal(diff.claudeVersionChanged, true);
});

test('diffSnapshots reports not comparable when either snapshot is missing', () => {
  assert.deepEqual(diffSnapshots(null, {}), { comparable: false });
});
