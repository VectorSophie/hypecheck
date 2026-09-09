// Conservative, regex-based capability detection over hook script source (or,
// when source isn't available, the raw command string itself — a
// `curl x | sh` pattern is visible in the command line with zero file
// access). False-negative-biased by design: this is not a malware scanner,
// it surfaces what's structurally evident and stays silent otherwise.

const PATTERNS = {
  readsStdinOrToolInput: /\b(?:process\.stdin|sys\.stdin|readFileSync\(0\b|input\(\))/i,
  // mutatesToolInput is intentionally loose (matches comparison operators like
  // `>=` too, not just assignment `=`) and is currently descriptive metadata
  // only — analyze.js's hookFinding does not use it to gate severity. Tighten
  // if it ever becomes a severity-gating signal.
  mutatesToolInput: /\b(?:tool_input|toolInput)\b.*=|updatedInput|modifiedInput/i,
  returnsPermissionDecision: /permissionDecision/,
  autoAllows: /permissionDecision['"]?\s*[:=]\s*['"]allow['"]/,
  canBlock: /permissionDecision['"]?\s*[:=]\s*['"]deny['"]|process\.exit\(\s*2\s*\)|sys\.exit\(\s*2\s*\)/,
  execsShell: /\b(?:child_process|subprocess|os\.system\(|exec(?:Sync)?\(|spawn(?:Sync)?\(|Popen\()/,
  filesystemRead: /\b(?:readFileSync|fs\.readFile|open\([^)]*['"]r|with\s+open\([^)]*['"]r)/,
  filesystemWrite: /\b(?:writeFileSync|appendFileSync|fs\.writeFile|open\([^)]*['"]w|with\s+open\([^)]*['"]w)/,
  network: /\b(?:fetch\(|https?\.request|http\.request|requests\.(?:get|post|put|delete)\(|urllib|axios\.|XMLHttpRequest)/i,
  credentialAccess: /\b(?:process\.env\.\w*(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL)\w*|os\.environ\[.?['"]?\w*(?:TOKEN|SECRET|KEY|PASSWORD)|os\.environ\.get\(.?['"]?\w*(?:TOKEN|SECRET|KEY|PASSWORD)|\.ssh\/|\.aws\/credentials|~\/\.netrc)/i,
  gitMutation: /\bgit\s+(?:push|commit|reset\s+--hard|checkout\s+-f)/,
  deployMutation: /\b(?:kubectl\s+apply|terraform\s+apply|gcloud\s+\S*\s*deploy|vercel\s+deploy|npm\s+publish)/i,
  destructive: /\brm\s+-rf\b|\bdel\s+\/[sf]\b|Remove-Item[^\n]*-Recurse[^\n]*-Force|DROP\s+TABLE|DELETE\s+FROM/i,
  pipesDownloadToShell: /\|\s*(?:sh|bash|zsh)\b|curl\s+[^|]*\|\s*\w+|base64\s+-d[^\n]*\|/i,
};

export function detectCapabilities(text) {
  const source = typeof text === 'string' ? text : '';
  const flags = {};
  for (const [key, pattern] of Object.entries(PATTERNS)) {
    flags[key] = pattern.test(source);
  }
  flags.failOpen = detectFailOpen(source);
  return flags;
}

function detectFailOpen(source) {
  const hasNonZeroExit = /process\.exit\(\s*[1-9]/.test(source) || /sys\.exit\(\s*[1-9]/.test(source);
  const hasSwallowedCatch = /catch\s*\([^)]*\)\s*\{\s*\}/.test(source) || /except[^:]*:\s*pass\b/.test(source);
  if (hasSwallowedCatch && !hasNonZeroExit) return 'open';
  if (hasNonZeroExit) return 'closed';
  return 'unknown';
}

const INTERPRETERS = new Set(['node', 'nodejs', 'python', 'python3', 'bash', 'sh', 'zsh', 'ruby', 'perl', 'pwsh', 'powershell']);
const SCRIPT_EXTENSION = /\.(?:js|mjs|cjs|py|sh|rb|pl|ps1)$/i;

// Heuristically extracts a repo-relative script path from a hook `command`
// string, resolved against the component's own root (so a hook in
// plugins/shunt/hooks/hooks.json referencing `route.js` resolves to
// plugins/shunt/route.js, not the repo root). Returns null when the command
// clearly isn't a local bundled script (a remote URL, an absolute/home path,
// or a bare external command with no path-like token) — deliberately
// conservative, a missed match just means the caller can't fetch source and
// falls back to command-line-only capability inference.
// Known limitation: only the FIRST resolvable script in a command is
// returned — a chained command (`node a.js && node b.js`) only surfaces
// `a.js`; the second script is invisible to analysis. Not fixed here since
// no caller exists yet to consume multiple paths; revisit if/when a real
// hook fixture needs it.
export function resolveLocalScriptPath(command, componentRoot = '') {
  if (!command || typeof command !== 'string') return null;

  const tokens = command.trim().split(/\s+/);
  for (const rawToken of tokens) {
    const token = rawToken.replace(/^["']|["']$/g, '');
    if (!token || token.startsWith('-')) continue;
    if (/^[A-Z_][A-Z0-9_]*=/.test(token)) continue; // env-var assignment prefix (e.g. PATH=/foo/bar node script.js), not the command itself
    if (INTERPRETERS.has(token.toLowerCase())) continue;
    if (/^https?:\/\//i.test(token)) return null;

    const looksLikePath = token.includes('/') || SCRIPT_EXTENSION.test(token);
    if (!looksLikePath) continue;

    if (/^[A-Za-z]:[\\/]/.test(token) || token.startsWith('/') || token.startsWith('~') || token.includes('\\')) return null;

    const cleaned = token.replace(/^\.\//, '');
    return componentRoot ? `${componentRoot}/${cleaned}` : cleaned;
  }

  return null;
}
