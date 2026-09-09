import { getClaudeVersion, listPlugins, getPluginDetails, readClaudeConfigFiles } from './claude-cli.js';
import { redact } from './redact.js';

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
      const details = [];
      for (const name of names) {
        const detail = await getPluginDetails(name, { execImpl });
        details.push({ name, ...detail });
      }
      plugins = { state: 'connected', list: details };
    } else {
      plugins = listed;
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
// defensive parsing already used by the reference shell script.
function extractPluginNames(data) {
  let arr = [];
  if (Array.isArray(data)) arr = data;
  else if (Array.isArray(data?.plugins)) arr = data.plugins;
  else if (Array.isArray(data?.installed)) arr = data.installed;
  else if (Array.isArray(data?.items)) arr = data.items;

  const names = [];
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue;
    const name = p.id ?? p.fullName ?? p.full_name ?? p.name ?? p.plugin;
    if (typeof name === 'string' && name) names.push(name);
  }
  return names;
}
