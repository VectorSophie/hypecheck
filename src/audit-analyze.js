import { ADVERSARIAL_DIR_KEYWORDS } from './discovery.js';

const ADVERSARIAL_DIR = new RegExp(`(^|/)(?:${ADVERSARIAL_DIR_KEYWORDS})/`, 'i');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
const WALK_BOUNDS = { maxDepth: 6, maxEntries: 2000 };

// Bounded recursive walk from `rootDir` looking for nested CLAUDE.md files.
// Claude Code loads nested CLAUDE.md on demand when it accesses that
// subtree — a CLAUDE.md checked in under a fixtures/tests/malicious-style
// directory (common in security-research repos) can become live agent
// instructions the moment something touches that path.
function findClaudeMdFiles(fs, rootDir) {
  const found = [];
  const budget = { entries: 0 };

  function visit(dir, depth) {
    if (depth > WALK_BOUNDS.maxDepth || budget.entries >= WALK_BOUNDS.maxEntries) return;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }

    for (const name of names) {
      if (budget.entries >= WALK_BOUNDS.maxEntries) return;
      budget.entries += 1;

      const full = `${dir}/${name}`;
      let isDirectory = false;
      try { isDirectory = fs.statSync(full).isDirectory(); } catch { continue; }

      if (isDirectory) {
        if (SKIP_DIRS.has(name)) continue;
        visit(full, depth + 1);
      } else if (name === 'CLAUDE.md') {
        found.push(full);
      }
    }
  }

  visit(rootDir, 0);
  return found;
}

function readGitignorePatterns(fs, rootDir) {
  try {
    const text = String(fs.readFileSync(`${rootDir}/.gitignore`));
    return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

// Best-effort: is this path (or a parent directory of it) covered by a
// .gitignore pattern? Real gitignore matching has many edge cases; this is a
// simplified segment-based check, not a full glob engine — it compares
// whole path segments (never raw substrings) specifically so a short,
// common pattern like "out" can't false-exclude an unrelated path like
// "fixtures/about/CLAUDE.md" ("about".includes("out") would wrongly match
// under naive substring comparison).
function isGitignored(relativePath, patterns) {
  const segments = relativePath.split('/');
  return patterns.some((pattern) => {
    const clean = pattern.replace(/^\/+|\/+$/g, '');
    if (!clean) return false;
    if (clean.includes('/')) return relativePath === clean || relativePath.startsWith(`${clean}/`);
    return segments.includes(clean);
  });
}

// No real "claudeMdExcludes" config surface exists in Claude Code today (the
// mega-spec's own phrasing calls it hypothetical) — .gitignore coverage is
// the practical, already-available substitute for "intentionally excluded."
export function detectInstructionBombs({ cwd, fs }) {
  if (!cwd || !fs) return [];

  const files = findClaudeMdFiles(fs, cwd);
  const patterns = readGitignorePatterns(fs, cwd);
  const findings = [];

  for (const filePath of files) {
    const relativePath = filePath.startsWith(`${cwd}/`) ? filePath.slice(cwd.length + 1) : filePath;
    if (!ADVERSARIAL_DIR.test(relativePath)) continue;
    if (isGitignored(relativePath, patterns)) continue;

    findings.push({
      id: 'nested-claude-md-hazard',
      severity: 'high',
      category: 'security',
      title: 'Adversarial-looking nested CLAUDE.md',
      evidence: `${relativePath} sits under a fixtures/tests/malicious-style directory. Claude Code loads nested CLAUDE.md files on demand — if this one is intentionally adversarial (e.g. security-research test fixtures), it can become live agent instructions. Add it to .gitignore, rename it, or generate it only into a temporary test directory.`,
    });
  }

  return findings;
}

// Detects a global (~/.claude) settings block that embeds a specific repo
// path/name not matching the project Hypecheck is currently running
// against — e.g. a global "Auto Mode" instructions block that says "this
// repo is X" while Claude was actually launched from unrelated repo Y.
// `/` is included in the capture so an "org/repo"-style reference (e.g.
// "this repo is acme/hypecheck") is captured whole rather than truncated at
// the slash — the comparison below then matches on its last segment, same
// as it does for `cwd`.
const REPO_REFERENCE = /\b(?:this repo(?:sitory)? is|repo(?:sitory)?:)\s*["'`]?([A-Za-z0-9._/-]+)["'`]?/i;

export function detectStaleGlobalContext({ cwd, configFiles }) {
  if (!cwd || !configFiles) return [];

  // cwd may be backslash-separated on Windows (process.cwd()'s native
  // format there) — split on either separator, not just POSIX '/'.
  const projectName = cwd.split(/[\\/]/).filter(Boolean).pop();
  if (!projectName) return [];

  const globalText = JSON.stringify(configFiles.globalSettings ?? {});
  const match = globalText.match(REPO_REFERENCE);
  if (!match) return [];

  const referencedRepo = match[1];
  if (!referencedRepo) return [];
  const referencedName = referencedRepo.split('/').filter(Boolean).pop() ?? referencedRepo;
  if (referencedName.toLowerCase() === projectName.toLowerCase()) return [];

  return [{
    id: 'stale-global-context',
    severity: 'medium',
    category: 'workflow',
    title: 'Global Claude config references a different repo',
    evidence: `Your global Claude settings reference "${referencedRepo}", but you're running from "${projectName}". A stale project-specific instructions block in global config can silently apply to the wrong repo.`,
  }];
}

// "projected"/"estimated" and "token(s)" can appear in either order around
// the number (e.g. "projected tokens: 5,000" vs. "projected 5,000 tokens"),
// so this can't be one directional regex binding the number to one specific
// side. Instead require both keywords to appear within a small window of
// each other, then pull the number only from that window — not from
// anywhere in the whole `details` string, which would risk matching an
// unrelated number (e.g. a "15000 requests/day" figure) that happens to
// share the text with both keywords used elsewhere for something else.
const PROJECTION_KEYWORD = /projected|estimated/i;
const TOKEN_KEYWORD = /tokens?/i;
const KEYWORD_PROXIMITY_WINDOW = 20;
const LARGE_TOKEN_THRESHOLD = 2000;

function extractProjectedTokenCount(text) {
  const projMatch = PROJECTION_KEYWORD.exec(text);
  const tokenMatch = TOKEN_KEYWORD.exec(text);
  if (!projMatch || !tokenMatch) return null;

  const projEnd = projMatch.index + projMatch[0].length;
  const tokenEnd = tokenMatch.index + tokenMatch[0].length;
  const gap = tokenMatch.index >= projEnd ? tokenMatch.index - projEnd : projMatch.index - tokenEnd;
  if (gap > KEYWORD_PROXIMITY_WINDOW) return null;

  const windowStart = Math.max(0, Math.min(projMatch.index, tokenMatch.index) - KEYWORD_PROXIMITY_WINDOW);
  const windowEnd = Math.min(text.length, Math.max(projEnd, tokenEnd) + KEYWORD_PROXIMITY_WINDOW);
  const numberMatch = text.slice(windowStart, windowEnd).match(/\d[\d,]*/);
  return numberMatch ? numberMatch[0] : null;
}

// Surfaces plugin/MCP inventory findings from the collector's output.
// Effort/model settings are reported as budget CONTEXT, never as a
// vulnerability — a high-effort default is an economic choice, not a
// security finding.
export function analyzeClaudeInventory(collected) {
  const findings = [];

  for (const plugin of collected?.plugins?.list ?? []) {
    const detailsText = typeof plugin.details === 'string' ? plugin.details : '';
    const numberText = extractProjectedTokenCount(detailsText);
    if (numberText) {
      const tokens = Number(numberText.replace(/,/g, ''));
      if (Number.isFinite(tokens) && tokens >= LARGE_TOKEN_THRESHOLD) {
        findings.push({
          id: 'plugin-high-token-cost',
          severity: 'low',
          category: 'workflow',
          title: 'Plugin has a large projected always-on token cost',
          evidence: `${plugin.name} projects ~${tokens.toLocaleString()} tokens always-on, per \`claude plugin details\`. Consider whether you need it enabled globally.`,
        });
      }
    }
  }

  const globalSettings = collected?.configFiles?.globalSettings;
  const effort = globalSettings?.effort ?? globalSettings?.defaultEffort;
  if (effort) {
    findings.push({
      id: 'effort-budget-context',
      severity: 'low',
      category: 'workflow',
      title: 'Global effort/model setting (budget context, not a finding)',
      evidence: `Global effort is set to "${effort}". This is informational — a higher effort level is an economic tradeoff, not a vulnerability.`,
    });
  }

  return findings;
}

// Combines all three local-audit analyzers into one findings list. This is
// what bin/hypecheck.js's cmdAudit calls (Task 10) — it does NOT include
// src/audit.js's separate scanLocalContext/auditSetup findings, which stay
// on their own independent (unchanged, synchronous, file-based) path.
export function analyzeClaudeAudit(collected, { cwd, fs } = {}) {
  return [
    ...detectInstructionBombs({ cwd, fs }),
    ...detectStaleGlobalContext({ cwd, configFiles: collected?.configFiles }),
    ...analyzeClaudeInventory(collected),
  ];
}
