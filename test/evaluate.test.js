import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidate } from '../src/evaluate.js';

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 404, async json() { return body; } };
}
function contentsResponse(obj) {
  return jsonResponse({ content: Buffer.from(JSON.stringify(obj)).toString('base64') });
}

test('single-component candidates evaluate exactly as before (no multiComponent field)', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/r')) return jsonResponse({ full_name: 'o/r', size: 10, default_branch: 'main' });
    return jsonResponse(null, false);
  };
  const report = await evaluateCandidate('o/r', { fetchImpl });
  assert.equal('multiComponent' in report, false);
  assert.ok(report.verdict);
});

test('multi-component marketplace candidates return a rollup with per-component verdicts', async () => {
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

  const report = await evaluateCandidate('o/r', { fetchImpl });

  assert.equal(report.multiComponent, true);
  assert.equal(report.componentCount, 2);
  assert.deepEqual(report.components.map((c) => c.path).sort(), ['plugins/a', 'plugins/b']);
  for (const component of report.components) {
    assert.ok(component.verdict);
    assert.ok(component.scores);
  }
});

test('an explicit subpath candidate against a marketplace repo evaluates as single-component', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/r')) return jsonResponse({ full_name: 'o/r', size: 10, default_branch: 'main' });
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: 'plugins/a/.claude-plugin/plugin.json', type: 'blob', size: 20 },
      ] });
    }
    if (url.endsWith('/contents/plugins/a/.claude-plugin/plugin.json')) return contentsResponse({ name: 'a' });
    return jsonResponse(null, false);
  };

  const report = await evaluateCandidate('o/r#plugins/a', { fetchImpl });
  assert.equal('multiComponent' in report, false);
  assert.ok(report.verdict);
});

test('--track is a documented no-op for multi-component candidates (no throw, no cache write)', async () => {
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

  // Must not throw, and must still return a normal multiComponent rollup —
  // --track is silently ignored, not an error, for multi-component candidates.
  const report = await evaluateCandidate('o/r', { fetchImpl, track: true });
  assert.equal(report.multiComponent, true);
  assert.equal(report.componentCount, 2);
});

test('a root-level component in a marketplace renders as "(root)" in the rollup', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/r')) return jsonResponse({ full_name: 'o/r', size: 10, default_branch: 'main' });
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: '.claude-plugin/plugin.json', type: 'blob', size: 20 },
        { path: 'plugins/b/.claude-plugin/plugin.json', type: 'blob', size: 20 },
      ] });
    }
    if (url.endsWith('/contents/.claude-plugin/plugin.json')) return contentsResponse({ name: 'root-plugin' });
    if (url.endsWith('/contents/plugins/b/.claude-plugin/plugin.json')) return contentsResponse({ name: 'b' });
    return jsonResponse(null, false);
  };

  const report = await evaluateCandidate('o/r', { fetchImpl });

  assert.equal(report.multiComponent, true);
  assert.deepEqual(report.components.map((c) => c.path).sort(), ['(root)', 'plugins/b']);
});
