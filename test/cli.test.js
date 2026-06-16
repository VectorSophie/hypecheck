import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidate } from '../src/evaluate.js';
import { runCli } from '../bin/hypecheck.js';

test('evaluates candidates with injected fetch and returns a scored report', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://registry.npmjs.org/sketchy-agent');
    return jsonResponse({
      name: 'sketchy-agent',
      license: null,
      'dist-tags': { latest: '1.0.0' },
      time: { '1.0.0': '2026-01-01T00:00:00Z' },
      versions: {
        '1.0.0': {
          scripts: { postinstall: 'node install.js' },
          dependencies: { execa: '^9.0.0' },
        },
      },
      readme: 'MCP server that can read .env files.',
    });
  };

  const report = await evaluateCandidate('sketchy-agent', {
    fetchImpl,
    now: new Date('2026-06-15T00:00:00Z'),
  });

  assert.equal(report.targetName, 'sketchy-agent');
  assert.equal(report.verdict, 'DANGEROUS');
});

test('CLI prints JSON when requested', async () => {
  const output = [];
  const exitCode = await runCli(['eval', 'safe-package', '--json'], {
    now: new Date('2026-06-15T00:00:00Z'),
    stdout: (text) => output.push(text),
    stderr: () => {},
    fetchImpl: async () => jsonResponse({
      name: 'safe-package',
      license: 'MIT',
      'dist-tags': { latest: '1.0.0' },
      time: { '1.0.0': '2026-06-01T00:00:00Z' },
      versions: { '1.0.0': {} },
      readme: 'Small utility.',
    }),
  });

  const parsed = JSON.parse(output.join(''));
  assert.equal(exitCode, 0);
  assert.equal(parsed.targetName, 'safe-package');
  assert.equal(parsed.verdict, 'INSTALL');
});

test('CLI prints markdown and nonzero exit for dangerous verdict', async () => {
  const output = [];
  const exitCode = await runCli(['eval', 'sketchy-agent'], {
    now: new Date('2026-06-15T00:00:00Z'),
    stdout: (text) => output.push(text),
    stderr: () => {},
    fetchImpl: async () => jsonResponse({
      name: 'sketchy-agent',
      license: null,
      'dist-tags': { latest: '1.0.0' },
      time: { '1.0.0': '2026-01-01T00:00:00Z' },
      versions: {
        '1.0.0': {
          scripts: { postinstall: 'node install.js' },
          dependencies: { execa: '^9.0.0' },
        },
      },
      readme: 'MCP server that can read .env files.',
    }),
  });

  assert.equal(exitCode, 1);
  assert.match(output.join(''), /Verdict: DANGEROUS/);
});

test('CLI scans local context and flags redundancy via injected fs', async () => {
  const output = [];
  const fs = {
    readFileSync: (p) => {
      if (p === '/proj/package.json') return JSON.stringify({ dependencies: { prettier: '^3' } });
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    readdirSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  };
  await runCli(['eval', 'prettier', '--json'], {
    stdout: (t) => output.push(t),
    stderr: () => {},
    scanCwd: '/proj',
    scanHome: '/home',
    fsImpl: fs,
    fetchImpl: async () => jsonResponse({
      name: 'prettier', license: 'MIT',
      'dist-tags': { latest: '3.0.0' }, time: { '3.0.0': '2026-06-01T00:00:00Z' },
      versions: { '3.0.0': {} }, readme: 'An opinionated code formatter.',
    }),
  });
  const parsed = JSON.parse(output.join(''));
  assert.ok(parsed.findings.some((f) => f.id === 'redundant-installed'));
  assert.ok(parsed.scores.redundancy > 1);
});

test('CLI --no-scan skips local context', async () => {
  const output = [];
  await runCli(['eval', 'prettier', '--json', '--no-scan'], {
    stdout: (t) => output.push(t),
    stderr: () => {},
    fsImpl: { readFileSync: () => { throw new Error('should not read'); }, readdirSync: () => { throw new Error('should not read'); } },
    fetchImpl: async () => jsonResponse({
      name: 'prettier', license: 'MIT',
      'dist-tags': { latest: '3.0.0' }, time: { '3.0.0': '2026-06-01T00:00:00Z' },
      versions: { '3.0.0': {} }, readme: 'An opinionated code formatter.',
    }),
  });
  const parsed = JSON.parse(output.join(''));
  assert.equal(parsed.scores.redundancy, 1);
  assert.match(parsed.unknowns.join(' '), /not scanned/i);
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}
