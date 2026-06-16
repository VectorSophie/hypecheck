import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../bin/hypecheck.js';
import { FINDING_DOCS } from '../src/finding-docs.js';

test('explain prints why + how-to-verify for a known finding id', async () => {
  const out = [];
  const code = await runCli(['explain', 'configured-hook'], { stdout: (t) => out.push(t), stderr: () => {} });
  const text = out.join('');
  assert.equal(code, 0);
  assert.match(text, /configured-hook/);
  assert.match(text, /verify/i);
});

test('explain on an unknown id exits 2 and lists known ids', async () => {
  const err = [];
  const code = await runCli(['explain', 'nope-not-real'], { stdout: () => {}, stderr: (t) => err.push(t) });
  assert.equal(code, 2);
  assert.match(err.join(''), /configured-hook/); // lists known ids
});

test('catalog documents the security-critical finding ids', () => {
  for (const id of ['configured-hook', 'shell-in-hook', 'drift-detected', 'hook-event-collision', 'secret-reference']) {
    assert.ok(FINDING_DOCS[id], `missing doc for ${id}`);
    assert.ok(FINDING_DOCS[id].why && FINDING_DOCS[id].verify);
  }
});
