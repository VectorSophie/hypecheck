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
