import test from 'node:test';
import assert from 'node:assert/strict';
import { profileUser, tagTech } from '../src/profile.js';

// fs stub: a path->contents map for files, path->entries for dirs.
function stubFs(files = {}) {
  return {
    readFileSync: (p) => {
      if (p in files) return files[p];
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    readdirSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  };
}

test('tagTech maps language signals to stack tags', () => {
  assert.ok(tagTech('cargo build').has('rust'));
  assert.ok(tagTech('a typescript project').has('ts'));
  assert.ok(tagTech('nothing relevant here').size === 0);
});

test('derives tech tags from a project permissions allowlist', () => {
  const fs = stubFs({
    '/proj/.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(cargo:*)', 'Bash(npm run:*)'] } }),
  });
  const profile = profileUser({ cwd: '/proj', fs });
  assert.ok(profile.techTags.has('rust'));
  assert.ok(profile.techTags.has('js'));
});

test('derives language tags from project manifests', () => {
  const fs = stubFs({ '/proj/go.mod': 'module example.com/x' });
  const profile = profileUser({ cwd: '/proj', fs });
  assert.ok(profile.techTags.has('go'));
});

test('no signals yields an empty profile', () => {
  const profile = profileUser({ cwd: '/proj', home: '/home', fs: stubFs() });
  assert.equal(profile.techTags.size, 0);
});

test('reads the user-scope settings allowlist too', () => {
  const fs = stubFs({
    '/home/.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(docker:*)'] } }),
  });
  const profile = profileUser({ home: '/home', fs });
  assert.ok(profile.techTags.has('docker'));
});
