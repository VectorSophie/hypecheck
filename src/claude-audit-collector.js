import { getClaudeVersion, listPlugins, getPluginDetails, readClaudeConfigFiles } from './claude-cli.js';
import { redact } from './redact.js';

// Plugin-detail lookups are independent, so running them fully concurrent
// (unbounded Promise.all) seemed like the obvious win over N sequential 5s
// timeouts. In practice it backfires: each lookup spawns a real `claude`
// child process, and N of those contending for CPU/IO at once measurably
// slows every individual call down — empirically, 10 concurrent lookups
// that each take ~3s standalone turned into 9-10 timeouts. Capping
// concurrency keeps the parallelism win (still far better than fully
// sequential) without starving every call at once.
const PLUGIN_DETAIL_CONCURRENCY = 4;

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Orchestrates everything Phase 4 knows how to collect about the user's
// local Claude Code setup into one structured, state-tagged, ALREADY-REDACTED
// result. Every field is tagged with what state it's actually in — this file
// tracks state, src/audit-analyze.js turns state into findings.
export async function collectClaudeAudit({ cwd, home, fs, execImpl, now = new Date() } = {}) {
  const version = await getClaudeVersion({ execImpl });
  const configFiles = readClaudeConfigFiles({ cwd, home, fs });

  let plugins = { state: 'unavailable', list: [] };
  if (version.state === 'connected') {
    const listed = await listPlugins({ execImpl });
    if (listed.state === 'connected') {
      const names = extractPluginNames(listed.plugins);
      const details = await mapWithConcurrency(names, PLUGIN_DETAIL_CONCURRENCY, async (name) => ({
        name,
        ...(await getPluginDetails(name, { execImpl })),
      }));
      plugins = { state: 'connected', list: details };
    } else {
      // Every non-connected state gets a consistent shape: downstream
      // consumers can rely on `.list` existing regardless of *which* call
      // failed, without needing to branch on `state`.
      plugins = { ...listed, list: [] };
    }
  }

  const result = {
    collectedAt: now.toISOString(),
    claudeCli: version,
    plugins,
    configFiles,
  };

  return redact(result);
}

// `claude plugin list --json` shape varies by version — accept an array, or
// an object with a plugins/installed/items array, matching the same
// defensive parsing already used by the reference shell script's inline
// PLUGIN_NAMES node script, which this ports faithfully: dedup by name,
// and append an explicit marketplace
// suffix when the JSON gives one and the name doesn't already carry one
// (`claude plugin details` needs the suffix to resolve in that case).
function extractPluginNames(data) {
  let arr = [];
  if (Array.isArray(data)) arr = data;
  else if (Array.isArray(data?.plugins)) arr = data.plugins;
  else if (Array.isArray(data?.installed)) arr = data.installed;
  else if (Array.isArray(data?.items)) arr = data.items;

  const seen = new Set();
  const names = [];
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue;
    let name = p.id ?? p.fullName ?? p.full_name ?? p.name ?? p.plugin;
    if (typeof name !== 'string' || !name) continue;

    const market = p.marketplace ?? p.marketplaceName ?? p.sourceMarketplace;
    if (market && !name.includes('@')) name += `@${market}`;

    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}
