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

test('CLI derives a stack profile from local config and notes mismatch', async () => {
  const output = [];
  const fs = {
    readFileSync: (p) => {
      if (p === '/proj/.claude/settings.json') return JSON.stringify({ permissions: { allow: ['Bash(cargo:*)'] } });
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    readdirSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  };
  await runCli(['eval', 'some-ts-tool', '--json'], {
    now: new Date('2026-06-15T00:00:00Z'),
    stdout: (t) => output.push(t),
    stderr: () => {},
    scanCwd: '/proj',
    scanHome: '/home',
    fsImpl: fs,
    fetchImpl: async () => jsonResponse({
      name: 'some-ts-tool', license: 'MIT',
      'dist-tags': { latest: '1.0.0' }, time: { '1.0.0': '2026-06-01T00:00:00Z' },
      versions: { '1.0.0': {} }, readme: 'A typescript library for your tsconfig.',
    }),
  });
  const parsed = JSON.parse(output.join(''));
  assert.equal(parsed.fit.signal, 'mismatch');
  assert.ok(parsed.fit.tags.includes('ts'));
});

test('eval renders a rollup with per-component verdicts for a marketplace repo', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/r')) return jsonResponse({ full_name: 'o/r', size: 10, default_branch: 'main' });
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: '.claude-plugin/marketplace.json', type: 'blob', size: 40 },
        { path: 'plugins/a/.claude-plugin/plugin.json', type: 'blob', size: 20 },
        { path: 'plugins/b/.claude-plugin/plugin.json', type: 'blob', size: 20 },
      ] });
    }
    if (url.endsWith('/contents/.claude-plugin/marketplace.json')) {
      return contentsResponse({ plugins: [{ name: 'a', source: './plugins/a' }, { name: 'b', source: './plugins/b' }] });
    }
    if (url.endsWith('/contents/plugins/a/.claude-plugin/plugin.json')) return contentsResponse({ name: 'a' });
    if (url.endsWith('/contents/plugins/b/.claude-plugin/plugin.json')) return contentsResponse({ name: 'b' });
    return jsonResponse(null, false);
  };

  let out = '';
  const code = await runCli(['eval', 'o/r', '--no-scan'], { fetchImpl, stdout: (t) => { out += t; }, stderr: () => {} });

  assert.match(out, /2 components/);
  assert.match(out, /plugins\/a/);
  assert.match(out, /plugins\/b/);
  assert.equal(typeof code, 'number');
});

test('eval output includes a Token economics section when evidence is found', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/r')) return jsonResponse({ full_name: 'o/r', size: 10, default_branch: 'main' });
    if (url.endsWith('/repos/o/r/readme')) {
      return jsonResponse({ content: Buffer.from('This tool saves 90% of your tokens by caching results.').toString('base64') });
    }
    return jsonResponse(null, false);
  };

  let out = '';
  const code = await runCli(['eval', 'o/r', '--no-scan'], { fetchImpl, stdout: (t) => { out += t; }, stderr: () => {} });

  assert.match(out, /## Token economics/);
  assert.match(out, /90%/);
  assert.equal(typeof code, 'number');
});

test('eval output omits the Token economics section when no evidence is found', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/r')) return jsonResponse({ full_name: 'o/r', size: 10, default_branch: 'main' });
    return jsonResponse(null, false);
  };

  let out = '';
  await runCli(['eval', 'o/r', '--no-scan'], { fetchImpl, stdout: (t) => { out += t; }, stderr: () => {} });

  assert.doesNotMatch(out, /## Token economics/);
});

test('eval output renders all Token economics branches: claim, source mechanism, readme mechanism, benchmark, labels', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/r')) return jsonResponse({ full_name: 'o/r', size: 10, default_branch: 'main' });
    if (url.endsWith('/repos/o/r/readme')) {
      return jsonResponse({ content: Buffer.from('Saves 90% of tokens by routing to a cheaper model and filtering noisy output.').toString('base64') });
    }
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: 'bench/results.json', type: 'blob', size: 20 },
        { path: 'hooks/hooks.json', type: 'blob', size: 20 },
      ] });
    }
    if (url.endsWith('/contents/hooks/hooks.json')) {
      return jsonResponse({ content: Buffer.from(JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: 'node hooks/route.js' }] }] } })).toString('base64') });
    }
    if (url.endsWith('/contents/hooks/route.js')) {
      return jsonResponse({ content: Buffer.from('function route() { return cache(delegate to a cheaper model result); }').toString('base64') });
    }
    return jsonResponse(null, false);
  };

  let out = '';
  await runCli(['eval', 'o/r', '--no-scan'], { fetchImpl, stdout: (t) => { out += t; }, stderr: () => {} });

  assert.match(out, /## Token economics/);
  assert.match(out, /Evidence: benchmarked/);
  assert.match(out, /Claimed savings: 90%/);
  assert.match(out, /Mechanisms observed in fetched source:.*cheap-model-delegation/);
  assert.match(out, /Mechanisms mentioned in README \(not verified in source\):.*cheap-model-delegation/);
  assert.match(out, /Benchmark found:.*bench\/results\.json/);
  assert.match(out, /## Labels\n\nTOKEN_WIN/);
});

function jsonResponse(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

// GitHub "contents" endpoint responses are base64-encoded.
function contentsResponse(body) {
  return jsonResponse({ content: Buffer.from(JSON.stringify(body)).toString('base64') });
}
