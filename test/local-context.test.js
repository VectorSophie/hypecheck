import test from 'node:test';
import assert from 'node:assert/strict';
import { scanLocalContext } from '../src/local-context.js';

// Fake fs seam: forward-slash paths so tests are OS-agnostic.
function fakeFs(files = {}, dirs = {}) {
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    readFileSync: (p) => (p in files ? files[p] : (() => { throw enoent(); })()),
    readdirSync: (p) => (p in dirs ? dirs[p] : (() => { throw enoent(); })()),
  };
}

const opts = (files, dirs) => ({ cwd: '/proj', home: '/home', fs: fakeFs(files, dirs) });

test('returns empty list when nothing exists', () => {
  assert.deepEqual(scanLocalContext(opts()), []);
});

test('reads mcp servers from project .mcp.json', () => {
  const tools = scanLocalContext(opts({
    '/proj/.mcp.json': JSON.stringify({ mcpServers: { 'browser-tools': {} } }),
  }));
  const t = tools.find((x) => x.name === 'browser-tools');
  assert.equal(t.kind, 'mcp');
  assert.ok(t.tags.has('browser'));
});

test('reads npm scripts and deps from package.json', () => {
  const tools = scanLocalContext(opts({
    '/proj/package.json': JSON.stringify({ scripts: { crawl: 'node crawl.js' }, dependencies: { prettier: '^3' } }),
  }));
  assert.ok(tools.some((t) => t.kind === 'npm-script' && t.name === 'crawl'));
  const dep = tools.find((t) => t.kind === 'dep' && t.name === 'prettier');
  assert.ok(dep.tags.has('formatting'));
});

test('skips generic npm script names (universal noise)', () => {
  const tools = scanLocalContext(opts({
    '/proj/package.json': JSON.stringify({ scripts: { test: 'node --test', build: 'tsc', deploy: './deploy.sh' } }),
  }));
  assert.equal(tools.some((t) => t.kind === 'npm-script' && t.name === 'test'), false);
  assert.equal(tools.some((t) => t.kind === 'npm-script' && t.name === 'build'), false);
  // a non-generic script name is still kept
  assert.equal(tools.some((t) => t.kind === 'npm-script' && t.name === 'deploy'), true);
});

test('reads command/skill names from directories', () => {
  const tools = scanLocalContext(opts({}, {
    '/proj/.claude/commands': ['review.md', 'deploy.md'],
  }));
  const review = tools.find((t) => t.name === 'review');
  assert.equal(review.kind, 'command');
  assert.ok(review.tags.has('code-review'));
});

test('local hooks carry their event for collision detection', () => {
  const tools = scanLocalContext(opts({
    '/proj/.claude/settings.json': JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ command: 'fmt' }] }] } }),
  }));
  const hook = tools.find((t) => t.kind === 'hook');
  assert.equal(hook.event, 'PostToolUse');
});

test('does not read secret env values from .claude.json', () => {
  const tools = scanLocalContext(opts({
    '/home/.claude.json': JSON.stringify({ mcpServers: { db: { env: { SECRET_TOKEN: 'xyz' } } } }),
  }));
  const db = tools.find((t) => t.name === 'db');
  assert.equal(db.kind, 'mcp');
  // the secret value must not appear anywhere in the scanned output
  assert.ok(!JSON.stringify(tools).includes('xyz'));
});
