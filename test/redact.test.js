import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactText } from '../src/redact.js';

test('redacts values under credential-shaped keys regardless of value shape', () => {
  const result = redact({ token: 'abc123', name: 'safe' });
  assert.equal(result.token, '[REDACTED]');
  assert.equal(result.name, 'safe');
});

test('redacts nested objects and arrays', () => {
  const result = redact({ servers: [{ name: 'db', env: { API_KEY: 'xyz' } }] });
  assert.equal(result.servers[0].env.API_KEY, '[REDACTED]');
  assert.equal(result.servers[0].name, 'db');
});

test('redacts secret-shaped values even under an innocent key', () => {
  const result = redact({ notes: 'Bearer sk-abc123xyz' });
  assert.equal(result.notes, '[REDACTED]');
});

test('redacts GitHub PAT / OAuth / Slack / AWS shaped values', () => {
  assert.equal(redact({ v: 'ghp_abcdefghijklmnopqrstuvwxyz1234' }).v, '[REDACTED]');
  assert.equal(redact({ v: 'github_pat_abcdefghijklmnopqrstuvwxyz' }).v, '[REDACTED]');
  assert.equal(redact({ v: 'xoxb-123456-abcdefghij' }).v, '[REDACTED]');
  assert.equal(redact({ v: 'AKIAABCDEFGHIJKLMNOP' }).v, '[REDACTED]');
});

test('leaves ordinary values untouched', () => {
  const result = redact({ name: 'my-plugin', count: 5, enabled: true });
  assert.deepEqual(result, { name: 'my-plugin', count: 5, enabled: true });
});

test('redactText scrubs secret-shaped substrings out of raw strings', () => {
  const text = redactText('Auth failed: Bearer sk-abcdefghijklmnop was rejected');
  assert.doesNotMatch(text, /sk-abcdefghijklmnop/);
  assert.match(text, /\[REDACTED\]/);
});

test('redactText leaves non-string input untouched', () => {
  assert.equal(redactText(undefined), undefined);
  assert.equal(redactText(42), 42);
});

test('redact() catches mid-string embedded secrets under innocuous keys', () => {
  const result = redact({
    command: "curl -H 'Authorization: Bearer ghp_abcdefghijklmnopqrst12' https://example.com"
  });
  assert.equal(result.command, '[REDACTED]');
});

test('redact() catches secret-shaped strings in plain arrays', () => {
  const result = redact(['Bearer sk-abcdefghijklmnop']);
  assert.equal(result[0], '[REDACTED]');
});

test('redact() collapses a value containing a PEM private key to fully redacted', () => {
  const result = redact({ deployKey: '-----BEGIN PRIVATE KEY-----\nMIIExampleKeyMaterial\n-----END PRIVATE KEY-----' });
  assert.equal(result.deployKey, '[REDACTED]');
});

test('redactText() strips the ENTIRE PEM block, not just the header line — the key material must not survive', () => {
  const text = redactText('log dump: -----BEGIN PRIVATE KEY-----\nMIIExampleKeyMaterialBase64Body\n-----END PRIVATE KEY-----\nend of dump');
  assert.doesNotMatch(text, /MIIExampleKeyMaterialBase64Body/);
  assert.doesNotMatch(text, /-----BEGIN PRIVATE KEY-----/);
  assert.doesNotMatch(text, /-----END PRIVATE KEY-----/);
  assert.match(text, /\[REDACTED\]/);
});

test('redactText() handles RSA/EC/OPENSSH/ENCRYPTED PRIVATE KEY header variants', () => {
  for (const kind of ['RSA', 'EC', 'OPENSSH', 'ENCRYPTED']) {
    const text = redactText(`-----BEGIN ${kind} PRIVATE KEY-----\nbody\n-----END ${kind} PRIVATE KEY-----`);
    assert.doesNotMatch(text, /body/, `expected ${kind} key body to be redacted`);
  }
});
