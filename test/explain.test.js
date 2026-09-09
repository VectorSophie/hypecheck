import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../bin/hypecheck.js';
import { FINDING_DOCS, explainFinding } from '../src/finding-docs.js';

test('explain prints why + how-to-verify for a known finding id', async () => {
  const out = [];
  const code = await runCli(['explain', 'hook-dangerous-capability'], { stdout: (t) => out.push(t), stderr: () => {} });
  const text = out.join('');
  assert.equal(code, 0);
  assert.match(text, /hook-dangerous-capability/);
  assert.match(text, /verify/i);
});

test('explain on an unknown id exits 2 and lists known ids', async () => {
  const err = [];
  const code = await runCli(['explain', 'nope-not-real'], { stdout: () => {}, stderr: (t) => err.push(t) });
  assert.equal(code, 2);
  assert.match(err.join(''), /hook-dangerous-capability/); // lists known ids
});

test('catalog documents the security-critical finding ids', () => {
  for (const id of ['hook-dangerous-capability', 'hook-permission-bypass', 'drift-detected', 'hook-event-collision', 'secret-reference']) {
    assert.ok(FINDING_DOCS[id], `missing doc for ${id}`);
    assert.ok(FINDING_DOCS[id].why && FINDING_DOCS[id].verify);
  }
});

test('explain works for all four hookFinding capability-aware finding ids', () => {
  for (const id of ['hook-dangerous-capability', 'hook-permission-bypass', 'hook-unverified-powerful', 'hook-benign-bounded']) {
    const text = explainFinding(id);
    assert.ok(text, `expected an explanation for ${id}`);
    assert.match(text, new RegExp(id));
  }
});

test('retired finding ids (configured-hook, shell-in-hook) no longer resolve — the analyzer can never emit them', () => {
  assert.equal(explainFinding('configured-hook'), null);
  assert.equal(explainFinding('shell-in-hook'), null);
});
