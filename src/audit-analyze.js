const ADVERSARIAL_DIR = /(^|\/)(?:fixtures?|tests?|testdata|examples?|corpus|malicious|adversarial)\//i;
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
// conservative substring/prefix check, not a full glob engine — a false
// "not excluded" just means the finding still fires, which is the safe
// direction to be wrong in.
function isGitignored(relativePath, patterns) {
  return patterns.some((pattern) => {
    const clean = pattern.replace(/^\/+|\/+$/g, '');
    return clean && relativePath.includes(clean);
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
