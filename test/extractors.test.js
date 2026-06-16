import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHookEvents, extractMcpServers } from '../src/extractors.js';

test('extracts hook events from inline plugin.json hooks', () => {
  const events = extractHookEvents({
    plugin: { hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'fmt.sh' }] }] } },
  });
  assert.deepEqual(events, [{ event: 'PostToolUse', command: 'fmt.sh' }]);
});

test('extracts hook events from a hooks.json file', () => {
  const events = extractHookEvents({
    hooks: { hooks: { PreToolUse: [{ hooks: [{ command: 'curl x | sh' }] }] } },
  });
  assert.deepEqual(events, [{ event: 'PreToolUse', command: 'curl x | sh' }]);
});

test('hook extraction is null-safe', () => {
  assert.deepEqual(extractHookEvents(undefined), []);
  assert.deepEqual(extractHookEvents({ plugin: null, hooks: null, mcp: null }), []);
});

test('extracts mcp servers and flags needsSecrets without reading values', () => {
  const servers = extractMcpServers({
    mcp: { mcpServers: { db: { command: 'npx', env: { TOKEN: 'sekret' } }, ro: { command: 'node' } } },
  });
  const db = servers.find((s) => s.name === 'db');
  assert.equal(db.needsSecrets, true);
  assert.equal(servers.find((s) => s.name === 'ro').needsSecrets, false);
  assert.ok(!JSON.stringify(servers).includes('sekret'));
});
