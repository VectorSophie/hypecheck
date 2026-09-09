import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectInstructionBombs,
  detectStaleGlobalContext,
  analyzeClaudeInventory,
  analyzeClaudeAudit,
} from '../src/audit-analyze.js';

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

test('flags a nested CLAUDE.md under __tests__ (the common Jest/Node convention)', () => {
  const fs = {
    readdirSync: (p) => {
      if (p === '/proj') return ['__tests__'];
      if (p === '/proj/__tests__') return ['CLAUDE.md'];
      return [];
    },
    statSync: (p) => ({ isDirectory: () => p === '/proj/__tests__' }),
    readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  };
  const findings = detectInstructionBombs({ cwd: '/proj', fs });
  assert.equal(findings.length, 1);
});

test('a short unrelated .gitignore entry does not false-exclude an adversarial-dir finding', () => {
  const fs = {
    readdirSync: (p) => {
      if (p === '/proj') return ['fixtures'];
      if (p === '/proj/fixtures') return ['about'];
      if (p === '/proj/fixtures/about') return ['CLAUDE.md'];
      return [];
    },
    statSync: (p) => ({ isDirectory: () => p === '/proj/fixtures' || p === '/proj/fixtures/about' }),
    readFileSync: (p) => {
      // "out" is a common .gitignore entry (build output dir) that must not
      // substring-match "about" and wrongly suppress this finding.
      if (p === '/proj/.gitignore') return 'out\n';
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
  };
  const findings = detectInstructionBombs({ cwd: '/proj', fs });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'nested-claude-md-hazard');
});

test('the bounded walk stops within maxEntries on a directory with a huge number of entries', () => {
  const hugeEntries = Array.from({ length: 5000 }, (_, i) => `file-${i}.txt`);
  let readdirCalls = 0;
  const fs = {
    readdirSync: (p) => {
      readdirCalls += 1;
      if (p === '/proj') return hugeEntries;
      return [];
    },
    statSync: () => ({ isDirectory: () => false }),
    readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  };
  const findings = detectInstructionBombs({ cwd: '/proj', fs });
  assert.deepEqual(findings, []);
  assert.equal(readdirCalls, 1);
});

test('flags a global settings block referencing a different repo', () => {
  const findings = detectStaleGlobalContext({
    cwd: '/home/user/hypecheck',
    configFiles: { globalSettings: { env: { AUTO_MODE_NOTE: 'this repo is other-project' } } },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'stale-global-context');
  assert.match(findings[0].evidence, /other-project/);
});

test('does not flag when the referenced repo matches the current project', () => {
  const findings = detectStaleGlobalContext({
    cwd: '/home/user/hypecheck',
    configFiles: { globalSettings: { env: { note: 'this repo is hypecheck' } } },
  });
  assert.deepEqual(findings, []);
});

test('does not flag when there is no repo reference at all', () => {
  const findings = detectStaleGlobalContext({
    cwd: '/home/user/hypecheck',
    configFiles: { globalSettings: { model: 'opus' } },
  });
  assert.deepEqual(findings, []);
});

test('returns no findings with missing cwd/configFiles', () => {
  assert.deepEqual(detectStaleGlobalContext({}), []);
});

test('correctly derives the project name from a Windows backslash-separated cwd', () => {
  const findings = detectStaleGlobalContext({
    cwd: 'C:\\Workspace\\hypecheck',
    configFiles: { globalSettings: { note: 'this repo is hypecheck' } },
  });
  assert.deepEqual(findings, [], 'a matching repo name must not be flagged just because cwd used backslashes');
});

test('flags a mismatched repo on a Windows backslash-separated cwd', () => {
  const findings = detectStaleGlobalContext({
    cwd: 'C:\\Workspace\\hypecheck',
    configFiles: { globalSettings: { note: 'this repo is other-project' } },
  });
  assert.equal(findings.length, 1);
});

test('does not flag an org/repo-style reference whose last segment matches the current project', () => {
  const findings = detectStaleGlobalContext({
    cwd: '/home/user/hypecheck',
    configFiles: { globalSettings: { note: 'this repo is acme/hypecheck' } },
  });
  assert.deepEqual(findings, []);
});

test('flags a plugin with a large projected token cost', () => {
  const findings = analyzeClaudeInventory({
    plugins: { list: [{ name: 'big-plugin', details: 'projected tokens: 5,000' }] },
  });
  assert.ok(findings.some((f) => f.id === 'plugin-high-token-cost' && /5,000/.test(f.evidence)));
});

test('does not flag a plugin with a small projected token cost', () => {
  const findings = analyzeClaudeInventory({
    plugins: { list: [{ name: 'small-plugin', details: 'projected tokens: 200' }] },
  });
  assert.deepEqual(findings.filter((f) => f.id === 'plugin-high-token-cost'), []);
});

test('reports effort as budget context, never as a vulnerability', () => {
  const findings = analyzeClaudeInventory({ configFiles: { globalSettings: { effort: 'high' } } });
  const finding = findings.find((f) => f.id === 'effort-budget-context');
  assert.ok(finding);
  assert.equal(finding.category, 'workflow');
  assert.notEqual(finding.severity, 'high');
});

test('handles missing plugin/config data gracefully', () => {
  assert.deepEqual(analyzeClaudeInventory({}), []);
  assert.deepEqual(analyzeClaudeInventory(undefined), []);
});

test('analyzeClaudeAudit combines all three analyzers', () => {
  const fs = {
    readdirSync: () => [],
    statSync: () => ({ isDirectory: () => false }),
    readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  };
  const findings = analyzeClaudeAudit({ plugins: { list: [] }, configFiles: {} }, { cwd: '/proj', fs });
  assert.deepEqual(findings, []);
});
