import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCandidateData } from '../src/fetchers.js';
import { analyzeCandidate } from '../src/analyze.js';

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 404, async json() { return body; } };
}
function readmeResponse(text) {
  return jsonResponse({ content: Buffer.from(text).toString('base64') });
}

test('Shunt-style: benchmark directory + a savings claim => benchmarked, TOKEN_WIN', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/shunt')) return jsonResponse({ full_name: 'o/shunt', size: 10, default_branch: 'main' });
    if (url.endsWith('/repos/o/shunt/readme')) {
      return readmeResponse('Shunt routes bulk file reads to a cheaper model, saving 92% of the parent model\'s tokens on large-read workloads.');
    }
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [{ path: 'bench/results.json', type: 'blob', size: 20 }] });
    }
    return jsonResponse(null, false);
  };
  const data = await fetchCandidateData({ type: 'github', owner: 'o', repo: 'shunt' }, { fetchImpl });
  const analysis = analyzeCandidate(data);
  assert.equal(analysis.tokenEconomics.evidenceTier, 'benchmarked');
  assert.equal(analysis.tokenEconomics.claim.percentage, 92);
  assert.ok(analysis.labels.includes('TOKEN_WIN'));
});

test('Token-Saver-style: bench directory + deterministic compression mechanism in real hook source => benchmarked', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/token-saver')) return jsonResponse({ full_name: 'o/token-saver', size: 10, default_branch: 'main' });
    if (url.endsWith('/repos/o/token-saver/readme')) return readmeResponse('Deterministically compresses verbose CLI output. Benchmarks show large reductions on typical output.');
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: 'bench/baseline.json', type: 'blob', size: 20 },
        { path: 'hooks/hooks.json', type: 'blob', size: 20 },
      ] });
    }
    if (url.endsWith('/contents/hooks/hooks.json')) {
      return jsonResponse({ content: Buffer.from(JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: 'node hooks/compress.js' }] }] } })).toString('base64') });
    }
    if (url.endsWith('/contents/hooks/compress.js')) {
      return jsonResponse({ content: Buffer.from('function compressOutput(text) { return truncate(summarize(text)); }').toString('base64') });
    }
    return jsonResponse(null, false);
  };
  const data = await fetchCandidateData({ type: 'github', owner: 'o', repo: 'token-saver' }, { fetchImpl });
  const analysis = analyzeCandidate(data);
  assert.equal(analysis.tokenEconomics.evidenceTier, 'benchmarked');
  assert.ok(analysis.tokenEconomics.mechanisms.fromSource.includes('compression'));
});

test('Context-Mode-style: mechanism mentioned only in README, no benchmark, no source evidence => inferred', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/context-mode')) return jsonResponse({ full_name: 'o/context-mode', size: 10, default_branch: 'main' });
    if (url.endsWith('/repos/o/context-mode/readme')) return readmeResponse('Sandboxes, filters, and indexes huge tool outputs using a semantic search index before returning results.');
    return jsonResponse(null, false);
  };
  const data = await fetchCandidateData({ type: 'github', owner: 'o', repo: 'context-mode' }, { fetchImpl });
  const analysis = analyzeCandidate(data);
  assert.equal(analysis.tokenEconomics.evidenceTier, 'inferred');
  assert.ok(analysis.tokenEconomics.mechanisms.fromReadme.includes('retrieval'));
  assert.ok(analysis.labels.includes('TOKEN_UNPROVEN'));
});

test('Save-The-Token-style: README transparently caveats methodology, still evaluated on the same evidence tier (transparency is not penalized or specially rewarded by this simple model)', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/save-the-token')) return jsonResponse({ full_name: 'o/save-the-token', size: 10, default_branch: 'main' });
    if (url.endsWith('/repos/o/save-the-token/readme')) {
      return readmeResponse('Reduces tokens by 60% on eligible cases only; evaluation is lexical, not semantic, and only 40% of real-world cases are eligible — see bench/ for the full coverage breakdown.');
    }
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [{ path: 'bench/coverage.md', type: 'blob', size: 20 }] });
    }
    return jsonResponse(null, false);
  };
  const data = await fetchCandidateData({ type: 'github', owner: 'o', repo: 'save-the-token' }, { fetchImpl });
  const analysis = analyzeCandidate(data);
  assert.equal(analysis.tokenEconomics.evidenceTier, 'benchmarked');
  assert.equal(analysis.tokenEconomics.claim.percentage, 60);
});

test('claimed-only: a savings percentage with no supporting mechanism or benchmark evidence', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/claims-only')) return jsonResponse({ full_name: 'o/claims-only', size: 10, default_branch: 'main' });
    if (url.endsWith('/repos/o/claims-only/readme')) return readmeResponse('This tool saves 99% of your tokens!');
    return jsonResponse(null, false);
  };
  const data = await fetchCandidateData({ type: 'github', owner: 'o', repo: 'claims-only' }, { fetchImpl });
  const analysis = analyzeCandidate(data);
  assert.equal(analysis.tokenEconomics.evidenceTier, 'claimed');
  assert.ok(analysis.labels.includes('TOKEN_UNPROVEN'));
});

test('unknown: no claim, no mechanism, no benchmark', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/repos/o/plain')) return jsonResponse({ full_name: 'o/plain', size: 10, default_branch: 'main' });
    if (url.endsWith('/repos/o/plain/readme')) return readmeResponse('A small utility for formatting dates.');
    return jsonResponse(null, false);
  };
  const data = await fetchCandidateData({ type: 'github', owner: 'o', repo: 'plain' }, { fetchImpl });
  const analysis = analyzeCandidate(data);
  assert.equal(analysis.tokenEconomics.evidenceTier, 'unknown');
  assert.deepEqual(analysis.labels, []);
});
