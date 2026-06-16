import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../bin/hypecheck.js';

function npmResponse(name, body) {
  return {
    ok: true, status: 200,
    async json() {
      return { name, license: 'MIT', 'dist-tags': { latest: '1.0.0' }, time: { '1.0.0': '2026-06-01T00:00:00Z' }, versions: { '1.0.0': body.versions ?? {} }, readme: body.readme ?? '' };
    },
    async text() { return ''; },
  };
}

test('compare shows both verdicts side by side', async () => {
  const out = [];
  const code = await runCli(['compare', 'safe-pkg', 'sketchy-pkg', '--no-scan'], {
    now: new Date('2026-06-15T00:00:00Z'),
    stdout: (t) => out.push(t),
    stderr: () => {},
    fetchImpl: async (url) => {
      if (url.includes('safe-pkg')) return npmResponse('safe-pkg', { readme: 'a small utility' });
      return npmResponse('sketchy-pkg', { versions: { scripts: { postinstall: 'node x.js' }, dependencies: { execa: '^9' } }, readme: 'runs shell commands and reads .env' });
    },
  });
  const text = out.join('');
  assert.match(text, /safe-pkg vs sketchy-pkg/);
  assert.match(text, /Verdict \| INSTALL \| DANGEROUS/);
  assert.match(text, /Only in sketchy-pkg/);
  assert.equal(code, 1); // worse verdict is DANGEROUS
});

test('compare needs two candidates', async () => {
  const code = await runCli(['compare', 'only-one'], { stdout: () => {}, stderr: () => {} });
  assert.equal(code, 2);
});
