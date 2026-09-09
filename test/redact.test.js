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
