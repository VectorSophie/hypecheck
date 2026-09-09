import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClaudeAudit } from '../src/claude-audit-collector.js';

test('collectClaudeAudit degrades to unavailable plugins when claude CLI is absent', async () => {
  const execImpl = async () => { const e = new Error('nf'); e.code = 'ENOENT'; throw e; };
  const result = await collectClaudeAudit({ execImpl, now: new Date('2026-01-01') });
  assert.equal(result.claudeCli.state, 'unavailable');
  assert.equal(result.plugins.state, 'unavailable');
});

test('collectClaudeAudit fetches plugin details for each installed plugin', async () => {
  const execImpl = async (cmd, args) => {
    if (args[0] === '--version') return { stdout: '1.0.0' };
    if (args.join(' ') === 'plugin list --json') return { stdout: JSON.stringify({ plugins: [{ id: 'foo@bar' }] }) };
    if (args.join(' ') === 'plugin details foo@bar') return { stdout: 'projected tokens: 500' };
    throw new Error(`unexpected: ${args.join(' ')}`);
  };
  const result = await collectClaudeAudit({ execImpl, now: new Date('2026-01-01') });
  assert.equal(result.plugins.state, 'connected');
  assert.equal(result.plugins.list[0].name, 'foo@bar');
  assert.equal(result.plugins.list[0].details, 'projected tokens: 500');
});

test('collectClaudeAudit redacts secrets found anywhere in config files', async () => {
  const execImpl = async () => { const e = new Error('nf'); e.code = 'ENOENT'; throw e; };
  const fs = { readFileSync: (p) => {
    if (p === '/proj/.mcp.json') return JSON.stringify({ mcpServers: { db: { env: { API_KEY: 'sk-abcdefghijklmnop' } } } });
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  } };
  const result = await collectClaudeAudit({ cwd: '/proj', fs, execImpl, now: new Date('2026-01-01') });
  assert.equal(result.configFiles.projectMcp.mcpServers.db.env.API_KEY, '[REDACTED]');
});

test('collectClaudeAudit never calls claude mcp list/get', async () => {
  const calls = [];
  const execImpl = async (cmd, args) => {
    calls.push(args);
    if (args[0] === '--version') return { stdout: '1.0.0' };
    if (args.join(' ') === 'plugin list --json') return { stdout: '{}' };
    throw new Error(`unexpected: ${args.join(' ')}`);
  };
  await collectClaudeAudit({ execImpl, now: new Date('2026-01-01') });
  assert.ok(!calls.some((args) => args[0] === 'mcp'));
});

test('collectClaudeAudit includes a collectedAt timestamp', async () => {
  const execImpl = async () => { const e = new Error('nf'); e.code = 'ENOENT'; throw e; };
  const result = await collectClaudeAudit({ execImpl, now: new Date('2026-06-15T00:00:00Z') });
  assert.equal(result.collectedAt, '2026-06-15T00:00:00.000Z');
});
