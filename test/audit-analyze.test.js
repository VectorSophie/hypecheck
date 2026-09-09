import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInstructionBombs } from '../src/audit-analyze.js';

test('flags a nested CLAUDE.md under a fixtures directory', () => {
  const fs = {
    readdirSync: (p) => {
      if (p === '/proj') return ['fixtures'];
      if (p === '/proj/fixtures') return ['CLAUDE.md'];
      return [];
    },
    statSync: (p) => ({ isDirectory: () => p === '/proj/fixtures' }),
    readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  };
  const findings = detectInstructionBombs({ cwd: '/proj', fs });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'nested-claude-md-hazard');
  assert.match(findings[0].evidence, /fixtures\/CLAUDE\.md/);
});

test('does not flag an ordinary nested CLAUDE.md outside an adversarial-named directory', () => {
  const fs = {
    readdirSync: (p) => {
      if (p === '/proj') return ['packages'];
      if (p === '/proj/packages') return ['CLAUDE.md'];
      return [];
    },
    statSync: (p) => ({ isDirectory: () => p === '/proj/packages' }),
    readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  };
  assert.deepEqual(detectInstructionBombs({ cwd: '/proj', fs }), []);
});

test('does not flag a fixtures CLAUDE.md that is already gitignored', () => {
  const fs = {
    readdirSync: (p) => {
      if (p === '/proj') return ['fixtures'];
      if (p === '/proj/fixtures') return ['CLAUDE.md'];
      return [];
    },
    statSync: (p) => ({ isDirectory: () => p === '/proj/fixtures' }),
    readFileSync: (p) => {
      if (p === '/proj/.gitignore') return 'fixtures/\n';
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
  };
  assert.deepEqual(detectInstructionBombs({ cwd: '/proj', fs }), []);
});

test('skips node_modules and .git directories entirely', () => {
  const fs = {
    readdirSync: (p) => {
      if (p === '/proj') return ['node_modules'];
      throw new Error(`should not descend into ${p}`);
    },
    statSync: () => ({ isDirectory: () => true }),
    readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  };
  assert.deepEqual(detectInstructionBombs({ cwd: '/proj', fs }), []);
});

test('returns no findings with no cwd/fs', () => {
  assert.deepEqual(detectInstructionBombs({}), []);
});
