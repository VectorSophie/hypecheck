import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCandidateData } from '../src/fetchers.js';
import { extractCandidateLinks, extractPackageSignals } from '../src/extractors.js';

test('fetches GitHub repository metadata and README', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/repos/owner/repo')) {
      return jsonResponse({
        full_name: 'owner/repo',
        description: 'A test MCP server',
        license: { spdx_id: 'MIT' },
        stargazers_count: 10,
        open_issues_count: 2,
        pushed_at: '2026-01-01T00:00:00Z',
        default_branch: 'main',
        size: 10,
      });
    }
    if (url.endsWith('/repos/owner/repo/readme')) {
      return jsonResponse({ content: Buffer.from('npm install\npostinstall').toString('base64') });
    }
    if (url.endsWith('/repos/owner/repo/contents/package.json')) {
      return jsonResponse({ content: Buffer.from(JSON.stringify({ scripts: { postinstall: 'x' } })).toString('base64') });
    }
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [] });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const data = await fetchCandidateData({ type: 'github', owner: 'owner', repo: 'repo' }, { fetchImpl });

  assert.equal(data.source, 'github');
  assert.equal(data.metadata.fullName, 'owner/repo');
  assert.equal(data.readme, 'npm install\npostinstall');
  assert.deepEqual(data.package.scripts, { postinstall: 'x' });
  assert.deepEqual(data.manifests, { plugin: null, hooks: null, mcp: null });
  assert.equal(data.components.length, 1);
});

test('GitHub fetch tolerates a missing package.json', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/owner/repo')) return jsonResponse({ full_name: 'owner/repo' });
    return jsonResponse(null, false); // everything else 404
  };
  const data = await fetchCandidateData({ type: 'github', owner: 'owner', repo: 'repo' }, { fetchImpl });
  assert.equal(data.package, null);
  assert.deepEqual(data.manifests, { plugin: null, hooks: null, mcp: null });
});

test('GitHub fetch lists candidate command and skill names via discovery', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/r')) return jsonResponse({ full_name: 'o/r', size: 10, default_branch: 'main' });
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: 'commands/review.md', type: 'blob', size: 10 },
        { path: 'commands/deploy.md', type: 'blob', size: 10 },
        { path: 'skills/lint-it/SKILL.md', type: 'blob', size: 10 },
      ] });
    }
    if (url.endsWith('/contents/commands/review.md') || url.endsWith('/contents/commands/deploy.md') || url.endsWith('/contents/skills/lint-it/SKILL.md')) {
      return jsonResponse({ content: Buffer.from('# doc').toString('base64') });
    }
    return jsonResponse(null, false);
  };
  const data = await fetchCandidateData({ type: 'github', owner: 'o', repo: 'r' }, { fetchImpl });
  assert.deepEqual(data.candidateCommands.sort(), ['deploy', 'review']);
});

test('GitHub fetch attaches parsed manifests', async () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/owner/repo')) return jsonResponse({ full_name: 'owner/repo', size: 10, default_branch: 'main' });
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: '.claude-plugin/plugin.json', type: 'blob', size: 10 },
        { path: 'hooks/hooks.json', type: 'blob', size: 10 },
        { path: '.mcp.json', type: 'blob', size: 10 },
      ] });
    }
    if (url.endsWith('/contents/.claude-plugin/plugin.json')) return jsonResponse({ content: b64({ name: 'p' }) });
    if (url.endsWith('/contents/hooks/hooks.json')) return jsonResponse({ content: b64({ hooks: { PreToolUse: [] } }) });
    if (url.endsWith('/contents/.mcp.json')) return jsonResponse({ content: b64({ mcpServers: {} }) });
    return jsonResponse(null, false);
  };
  const data = await fetchCandidateData({ type: 'github', owner: 'owner', repo: 'repo' }, { fetchImpl });
  assert.equal(data.manifests.plugin.name, 'p');
  assert.ok(data.manifests.hooks.hooks.PreToolUse);
  assert.deepEqual(data.manifests.mcp.mcpServers, {});
});

test('GitHub fetch honors an addressed subpath', async () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/spotify/portal-ai-plugins')) return jsonResponse({ full_name: 'spotify/portal-ai-plugins', size: 10, default_branch: 'main' });
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: 'plugins/shunt/.claude-plugin/plugin.json', type: 'blob', size: 10 },
        { path: 'plugins/other/.claude-plugin/plugin.json', type: 'blob', size: 10 },
      ] });
    }
    if (url.endsWith('/contents/plugins/shunt/.claude-plugin/plugin.json')) return jsonResponse({ content: b64({ name: 'shunt' }) });
    return jsonResponse(null, false);
  };
  const data = await fetchCandidateData({ type: 'github', owner: 'spotify', repo: 'portal-ai-plugins', subpath: 'plugins/shunt' }, { fetchImpl });
  assert.equal(data.components.length, 1);
  assert.equal(data.manifests.plugin.name, 'shunt');
});

test('fetches npm metadata and extracts package signals', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://registry.npmjs.org/execa');
    return jsonResponse({
      name: 'execa',
      description: 'Process execution',
      license: 'MIT',
      'dist-tags': { latest: '1.0.0' },
      time: { '1.0.0': '2026-01-01T00:00:00Z' },
      versions: {
        '1.0.0': {
          scripts: { postinstall: 'node install.js' },
          dependencies: { 'cross-spawn': '^7.0.0' },
          bin: { execa: './cli.js' },
          repository: { url: 'git+https://github.com/sindresorhus/execa.git' },
        },
      },
      readme: 'Run commands.',
    });
  };

  const data = await fetchCandidateData({ type: 'npm', packageName: 'execa' }, { fetchImpl });
  const signals = extractPackageSignals(data);

  assert.equal(data.source, 'npm');
  assert.equal(data.metadata.name, 'execa');
  assert.deepEqual(signals.lifecycleScripts, ['postinstall']);
  assert.deepEqual(signals.dependencies, ['cross-spawn']);
  assert.deepEqual(signals.bins, ['execa']);
});

test('npm fetch captures maintainer names without leaking emails', async () => {
  const fetchImpl = async () => jsonResponse({
    name: 'p', 'dist-tags': { latest: '1.0.0' }, time: { '1.0.0': '2026-01-01T00:00:00Z' },
    versions: { '1.0.0': {} }, maintainers: [{ name: 'alice', email: 'alice@secret.com' }, { name: 'bob', email: 'bob@x.com' }],
  });
  const data = await fetchCandidateData({ type: 'npm', packageName: 'p' }, { fetchImpl });
  assert.deepEqual(data.metadata.maintainers, ['alice', 'bob']);
  assert.ok(!JSON.stringify(data.metadata).includes('secret.com'));
});

test('sends a User-Agent and GITHUB_TOKEN auth header to the GitHub API', async () => {
  let init;
  const fetchImpl = async (url, opts) => {
    init = opts;
    return jsonResponse({ full_name: 'owner/repo' });
  };
  await fetchCandidateData({ type: 'github', owner: 'owner', repo: 'repo' }, { fetchImpl, githubToken: 'ghp_x' });
  assert.ok(init.headers['User-Agent']);
  assert.equal(init.headers.Authorization, 'Bearer ghp_x');
});

test('omits the auth header when no token is provided', async () => {
  // Isolate from the dev machine's own env — a real GITHUB_TOKEN set in the
  // shell must never leak into this assertion (or, worse, into test output).
  const priorToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    let init;
    const fetchImpl = async (url, opts) => {
      init = opts;
      return jsonResponse({ full_name: 'owner/repo' });
    };
    await fetchCandidateData({ type: 'github', owner: 'owner', repo: 'repo' }, { fetchImpl });
    assert.ok(init.headers['User-Agent']);
    assert.equal(init.headers.Authorization, undefined);
  } finally {
    if (priorToken !== undefined) process.env.GITHUB_TOKEN = priorToken;
  }
});

test('gives a helpful error when GitHub rate-limits (403)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, async json() { return {}; }, async text() { return ''; } });
  await assert.rejects(
    fetchCandidateData({ type: 'github', owner: 'o', repo: 'r' }, { fetchImpl }),
    /GITHUB_TOKEN/,
  );
});

test('extracts candidate links from social HTML', () => {
  const links = extractCandidateLinks(`
    <a href="https://github.com/VectorSophie/hypecheck">repo</a>
    <span>https://www.npmjs.com/package/execa</span>
  `);

  assert.deepEqual(links, [
    'https://github.com/VectorSophie/hypecheck',
    'https://www.npmjs.com/package/execa',
  ]);
});

function jsonResponse(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}
