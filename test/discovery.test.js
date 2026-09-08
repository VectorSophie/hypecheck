import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNDS, classifyPath, isPathSafe } from '../src/discovery.js';

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
