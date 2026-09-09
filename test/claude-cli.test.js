import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getClaudeVersion, listPlugins, getPluginDetails, readClaudeConfigFiles } from '../src/claude-cli.js';

test('getClaudeVersion returns connected state with trimmed version string', async () => {
  const execImpl = async (cmd, args) => {
    assert.equal(cmd, 'claude');
    assert.deepEqual(args, ['--version']);
    return { stdout: '1.2.3\n' };
  };
  const result = await getClaudeVersion({ execImpl });
  assert.equal(result.state, 'connected');
  assert.equal(result.version, '1.2.3');
});

test('subprocess calls never use a shell', async () => {
  let capturedOpts;
  const execImpl = async (cmd, args, opts) => { capturedOpts = opts; return { stdout: '1.0.0' }; };
  await getClaudeVersion({ execImpl });
  assert.equal(capturedOpts.shell, false);
});

test('missing claude binary degrades to unavailable, never throws', async () => {
  const execImpl = async () => { const e = new Error('not found'); e.code = 'ENOENT'; throw e; };
  const result = await getClaudeVersion({ execImpl });
  assert.equal(result.state, 'unavailable');
});

test('a timeout degrades to timeout state, never throws', async () => {
  const execImpl = async () => { const e = new Error('timed out'); e.killed = true; e.signal = 'SIGTERM'; throw e; };
  const result = await getClaudeVersion({ execImpl });
  assert.equal(result.state, 'timeout');
});

test('a generic subprocess failure degrades to failed state with a redacted message', async () => {
  const execImpl = async () => { throw new Error('boom: Bearer sk-abcdefghijklmnop'); };
  const result = await getClaudeVersion({ execImpl });
  assert.equal(result.state, 'failed');
  assert.doesNotMatch(result.error, /sk-abcdefghijklmnop/);
});

test('listPlugins parses the JSON payload', async () => {
  const execImpl = async () => ({ stdout: JSON.stringify({ plugins: [{ id: 'foo' }] }) });
  const result = await listPlugins({ execImpl });
  assert.equal(result.state, 'connected');
  assert.deepEqual(result.plugins, { plugins: [{ id: 'foo' }] });
});

test('listPlugins degrades gracefully on malformed JSON', async () => {
  const execImpl = async () => ({ stdout: 'not json' });
  const result = await listPlugins({ execImpl });
  assert.equal(result.state, 'failed');
});

test('getPluginDetails passes the plugin id through as an argument', async () => {
  const execImpl = async (cmd, args) => {
    assert.deepEqual(args, ['plugin', 'details', 'my-plugin@marketplace']);
    return { stdout: 'details text' };
  };
  const result = await getPluginDetails('my-plugin@marketplace', { execImpl });
  assert.equal(result.state, 'connected');
  assert.equal(result.details, 'details text');
});

test('claude mcp list/get are never invoked by this module (source scan)', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../src/claude-cli.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /['"]mcp['"]/);
});

test('readClaudeConfigFiles reads project and global config when present', () => {
  const fs = {
    readFileSync: (p) => {
      if (p === '/proj/.claude/settings.json') return JSON.stringify({ hooks: {} });
      if (p === '/home/.claude.json') return JSON.stringify({ mcpServers: { db: {} } });
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
  };
  const result = readClaudeConfigFiles({ cwd: '/proj', home: '/home', fs });
  assert.deepEqual(result.projectSettings, { hooks: {} });
  assert.deepEqual(result.globalClaudeJson, { mcpServers: { db: {} } });
  assert.equal(result.projectSettingsLocal, null);
});

test('readClaudeConfigFiles tolerates malformed JSON', () => {
  const fs = { readFileSync: () => 'not valid json' };
  const result = readClaudeConfigFiles({ cwd: '/proj', fs });
  assert.equal(result.projectSettings, null);
});

test('readClaudeConfigFiles is a no-op with no cwd/home', () => {
  const fs = { readFileSync: () => { throw new Error('should not be called'); } };
  assert.deepEqual(readClaudeConfigFiles({ fs }), {});
});

test('readClaudeConfigFiles reads .mcp.json and global settings.json at their exact paths', () => {
  const fs = {
    readFileSync: (p) => {
      if (p === '/proj/.mcp.json') return JSON.stringify({ mcpServers: { local: {} } });
      if (p === '/home/.claude/settings.json') return JSON.stringify({ model: 'opus' });
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
  };
  const result = readClaudeConfigFiles({ cwd: '/proj', home: '/home', fs });
  assert.deepEqual(result.projectMcp, { mcpServers: { local: {} } });
  assert.deepEqual(result.globalSettings, { model: 'opus' });
});

test('readClaudeConfigFiles skips a config file over the size bound instead of reading it', () => {
  const fs = {
    statSync: (p) => ({ size: p === '/proj/.claude/settings.json' ? 10 * 1024 * 1024 : 10 }),
    readFileSync: () => { throw new Error('should not be called for an oversized file'); },
  };
  const result = readClaudeConfigFiles({ cwd: '/proj', fs });
  assert.equal(result.projectSettings, null);
});

test('readClaudeConfigFiles works with an fs double that has no statSync (existing test convention)', () => {
  const fs = { readFileSync: () => JSON.stringify({ ok: true }) };
  const result = readClaudeConfigFiles({ cwd: '/proj', fs });
  assert.deepEqual(result.projectSettings, { ok: true });
});
