import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandidate } from '../src/candidate.js';

test('normalizes GitHub HTTPS URLs', () => {
  assert.deepEqual(normalizeCandidate('https://github.com/VectorSophie/hypecheck'), {
    type: 'github',
    original: 'https://github.com/VectorSophie/hypecheck',
    owner: 'VectorSophie',
    repo: 'hypecheck',
    canonical: 'https://github.com/VectorSophie/hypecheck',
  });
});

test('normalizes bare GitHub owner and repo pairs', () => {
  assert.deepEqual(normalizeCandidate('VectorSophie/hypecheck'), {
    type: 'github',
    original: 'VectorSophie/hypecheck',
    owner: 'VectorSophie',
    repo: 'hypecheck',
    canonical: 'https://github.com/VectorSophie/hypecheck',
  });
});

test('normalizes npm scoped packages', () => {
  assert.deepEqual(normalizeCandidate('@modelcontextprotocol/server-filesystem'), {
    type: 'npm',
    original: '@modelcontextprotocol/server-filesystem',
    packageName: '@modelcontextprotocol/server-filesystem',
    canonical: 'https://www.npmjs.com/package/%40modelcontextprotocol%2Fserver-filesystem',
  });
});

test('normalizes npm package URLs', () => {
  assert.deepEqual(normalizeCandidate('https://www.npmjs.com/package/execa'), {
    type: 'npm',
    original: 'https://www.npmjs.com/package/execa',
    packageName: 'execa',
    canonical: 'https://www.npmjs.com/package/execa',
  });
});

test('recognizes social links as link sources', () => {
  assert.deepEqual(normalizeCandidate('https://x.com/someone/status/123'), {
    type: 'social',
    original: 'https://x.com/someone/status/123',
    url: 'https://x.com/someone/status/123',
    canonical: 'https://x.com/someone/status/123',
  });
});

test('rejects empty candidates', () => {
  assert.throws(() => normalizeCandidate('  '), /Candidate is required/);
});

test('parses a subpath from fragment syntax', () => {
  assert.deepEqual(normalizeCandidate('spotify/portal-ai-plugins#plugins/shunt'), {
    type: 'github',
    original: 'spotify/portal-ai-plugins#plugins/shunt',
    owner: 'spotify',
    repo: 'portal-ai-plugins',
    canonical: 'https://github.com/spotify/portal-ai-plugins',
    subpath: 'plugins/shunt',
  });
});

test('parses a subpath from a GitHub tree URL', () => {
  assert.deepEqual(normalizeCandidate('https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt'), {
    type: 'github',
    original: 'https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt',
    owner: 'spotify',
    repo: 'portal-ai-plugins',
    canonical: 'https://github.com/spotify/portal-ai-plugins',
    subpath: 'plugins/shunt',
  });
});

test('parses a subpath from a GitHub URL fragment', () => {
  assert.deepEqual(normalizeCandidate('https://github.com/spotify/portal-ai-plugins#plugins/shunt'), {
    type: 'github',
    original: 'https://github.com/spotify/portal-ai-plugins#plugins/shunt',
    owner: 'spotify',
    repo: 'portal-ai-plugins',
    canonical: 'https://github.com/spotify/portal-ai-plugins',
    subpath: 'plugins/shunt',
  });
});

test('plain owner/repo has no subpath field', () => {
  const result = normalizeCandidate('VectorSophie/hypecheck');
  assert.equal('subpath' in result, false);
});

test('decodes percent-encoded segments in a GitHub tree URL subpath', () => {
  assert.deepEqual(normalizeCandidate('https://github.com/o/r/tree/main/my%20plugin/shunt'), {
    type: 'github',
    original: 'https://github.com/o/r/tree/main/my%20plugin/shunt',
    owner: 'o',
    repo: 'r',
    canonical: 'https://github.com/o/r',
    subpath: 'my plugin/shunt',
  });
});

test('does not throw on a malformed percent-encoded fragment subpath', () => {
  let result;
  assert.doesNotThrow(() => {
    result = normalizeCandidate('https://github.com/o/r#%zz');
  });
  assert.equal(result.subpath, '%zz');
});
