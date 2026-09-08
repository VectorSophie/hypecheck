import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNDS, classifyPath, isPathSafe, discoverTree } from '../src/discovery.js';

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 404, async json() { return body; } };
}

test('bounds are the documented constants', () => {
  assert.deepEqual(BOUNDS, {
    maxDepth: 6,
    maxEntries: 500,
    maxFiles: 40,
    maxBytes: 300_000,
    maxRequests: 60,
  });
});

test('classifies plugin, marketplace, hooks, mcp, skill, command, package manifests', () => {
  assert.equal(classifyPath('.claude-plugin/plugin.json'), 'plugin');
  assert.equal(classifyPath('plugins/shunt/.claude-plugin/plugin.json'), 'plugin');
  assert.equal(classifyPath('.claude-plugin/marketplace.json'), 'marketplace');
  assert.equal(classifyPath('hooks/hooks.json'), 'hooks');
  assert.equal(classifyPath('plugins/shunt/hooks/hooks.json'), 'hooks');
  assert.equal(classifyPath('hooks.json'), 'hooks');
  assert.equal(classifyPath('.mcp.json'), 'mcp');
  assert.equal(classifyPath('skills/lint/SKILL.md'), 'skill');
  assert.equal(classifyPath('.claude/skills/lint/SKILL.md'), 'skill');
  assert.equal(classifyPath('commands/deploy.md'), 'command');
  assert.equal(classifyPath('.claude/commands/deploy.md'), 'command');
  assert.equal(classifyPath('package.json'), 'package');
  assert.equal(classifyPath('plugins/shunt/package.json'), 'package');
});

test('classifies adversarial-path CLAUDE.md but not an ordinary one', () => {
  assert.equal(classifyPath('fixtures/malicious_claude_md/CLAUDE.md'), 'adversarial-claude-md');
  assert.equal(classifyPath('test/adversarial/CLAUDE.md'), 'adversarial-claude-md');
  assert.equal(classifyPath('CLAUDE.md'), null);
  assert.equal(classifyPath('docs/CLAUDE.md'), null);
});

test('does not classify unrelated or binary-looking files', () => {
  assert.equal(classifyPath('src/index.js'), null);
  assert.equal(classifyPath('assets/logo.png'), null);
  assert.equal(classifyPath('README.md'), null);
});

test('isPathSafe rejects path-traversal attempts', () => {
  assert.equal(isPathSafe('plugins/shunt'), true);
  assert.equal(isPathSafe('./plugins/shunt'), true);
  assert.equal(isPathSafe('../../etc/passwd'), false);
  assert.equal(isPathSafe('..'), false);
  assert.equal(isPathSafe('/etc/passwd'), false);
  assert.equal(isPathSafe('plugins/../../etc'), false);
});

test('isPathSafe rejects backslash, drive-letter, and UNC traversal', () => {
  assert.equal(isPathSafe('..\\..\\etc\\passwd'), false);
  assert.equal(isPathSafe('foo\\..\\..\\bar'), false);
  assert.equal(isPathSafe('C:\\Windows\\System32'), false);
  assert.equal(isPathSafe('\\\\server\\share\\file'), false);
  assert.equal(isPathSafe('C:foo'), false);
  assert.equal(isPathSafe(''), false);
});

test('discoverTree uses one recursive call for a small repo and finds root manifests', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    assert.equal(url, 'https://api.github.com/repos/o/r/git/trees/main?recursive=1');
    return jsonResponse({
      tree: [
        { path: '.claude-plugin/plugin.json', type: 'blob', size: 200 },
        { path: 'hooks/hooks.json', type: 'blob', size: 150 },
        { path: 'src/index.js', type: 'blob', size: 900 },
        { path: 'src', type: 'tree' },
      ],
    });
  };

  const result = await discoverTree(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 100, subpath: '',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(result.found.map((f) => f.path).sort(), ['.claude-plugin/plugin.json', 'hooks/hooks.json']);
  assert.ok(result.skipped.some((s) => s.path === 'src/index.js' && s.reason === 'not-interesting'));
  assert.equal(result.requestsUsed, 1);
});

test('discoverTree filters and reroots entries under a subpath', async () => {
  const fetchImpl = async () => jsonResponse({
    tree: [
      { path: 'plugins/shunt/.claude-plugin/plugin.json', type: 'blob', size: 200 },
      { path: 'plugins/other/.claude-plugin/plugin.json', type: 'blob', size: 200 },
    ],
  });

  const result = await discoverTree(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 100, subpath: 'plugins/shunt',
  });

  assert.deepEqual(result.found.map((f) => f.path), ['plugins/shunt/.claude-plugin/plugin.json']);
  assert.deepEqual(result.found.map((f) => f.relPath), ['.claude-plugin/plugin.json']);
});

test('discoverTree enforces the depth bound', async () => {
  const deepPath = `${'a/'.repeat(7)}hooks.json`; // depth 7, over maxDepth 6
  const fetchImpl = async () => jsonResponse({
    tree: [{ path: deepPath, type: 'blob', size: 10 }],
  });

  const result = await discoverTree(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 100, subpath: '',
  });

  assert.deepEqual(result.found, []);
  assert.deepEqual(result.skipped, [{ path: deepPath, reason: 'depth' }]);
});

test('discoverTree degrades gracefully when the tree fetch fails', async () => {
  const fetchImpl = async () => jsonResponse(null, false);
  const result = await discoverTree(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 100, subpath: '',
  });
  assert.deepEqual(result.found, []);
  assert.equal(result.requestsUsed, 1);
});
