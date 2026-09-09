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

test('collectClaudeAudit dedupes plugin names and appends a marketplace suffix when needed', async () => {
  const detailCalls = [];
  const execImpl = async (cmd, args) => {
    if (args[0] === '--version') return { stdout: '1.0.0' };
    if (args.join(' ') === 'plugin list --json') {
      return {
        stdout: JSON.stringify({
          plugins: [
            { name: 'foo', marketplace: 'acme' },
            { name: 'foo', marketplace: 'acme' },
            { id: 'bar@already' },
          ],
        }),
      };
    }
    detailCalls.push(args.join(' '));
    return { stdout: 'ok' };
  };
  const result = await collectClaudeAudit({ execImpl, now: new Date('2026-01-01') });
  assert.deepEqual(
    result.plugins.list.map((p) => p.name).sort(),
    ['bar@already', 'foo@acme'],
  );
  assert.equal(detailCalls.filter((c) => c === 'plugin details foo@acme').length, 1);
});

test('collectClaudeAudit gives every non-connected plugins state a consistent {state, list: []} shape', async () => {
  const execImpl = async (cmd, args) => {
    if (args[0] === '--version') return { stdout: '1.0.0' };
    if (args.join(' ') === 'plugin list --json') return { stdout: 'not json' };
    throw new Error(`unexpected: ${args.join(' ')}`);
  };
  const result = await collectClaudeAudit({ execImpl, now: new Date('2026-01-01') });
  assert.equal(result.plugins.state, 'failed');
  assert.deepEqual(result.plugins.list, []);
});

test('collectClaudeAudit fetches plugin details concurrently, not one at a time', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const execImpl = async (cmd, args) => {
    if (args[0] === '--version') return { stdout: '1.0.0' };
    if (args.join(' ') === 'plugin list --json') {
      return { stdout: JSON.stringify({ plugins: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }) };
    }
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return { stdout: 'ok' };
  };
  await collectClaudeAudit({ execImpl, now: new Date('2026-01-01') });
  assert.ok(maxInFlight > 1, `expected concurrent plugin-detail lookups, saw max ${maxInFlight} in flight`);
});
