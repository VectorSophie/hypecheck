import path from 'node:path';

export const BOUNDS = {
  maxDepth: 6,
  maxEntries: 500,
  maxFiles: 40,
  maxBytes: 300_000,
  maxRequests: 60,
};

const RECURSIVE_SIZE_THRESHOLD_KB = 5000;

const INTERESTING = [
  [/(^|\/)\.claude-plugin\/plugin\.json$/, 'plugin'],
  [/(^|\/)\.claude-plugin\/marketplace\.json$/, 'marketplace'],
  [/(^|\/)hooks\/hooks\.json$/, 'hooks'],
  [/(^|\/)hooks\.json$/, 'hooks'],
  [/(^|\/)\.mcp\.json$/, 'mcp'],
  [/(^|\/)(?:\.claude\/)?skills\/[^/]+\/SKILL\.md$/, 'skill'],
  [/(^|\/)(?:\.claude\/)?commands\/[^/]+\.md$/, 'command'],
  [/(^|\/)package\.json$/, 'package'],
];

const ADVERSARIAL_CLAUDE_MD = /(^|\/)(?:fixtures?|tests?|testdata|examples?|corpus|malicious|adversarial)\/.*CLAUDE\.md$/i;

export function classifyPath(relativePath) {
  for (const [re, kind] of INTERESTING) {
    if (re.test(relativePath)) return kind;
  }
  if (ADVERSARIAL_CLAUDE_MD.test(relativePath)) return 'adversarial-claude-md';
  return null;
}

// Guards marketplace.json `source` entries: never follow a path that
// escapes the repo root.
export function isPathSafe(relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '') return false;
  if (relativePath.includes('\\')) return false; // never valid in a repo-relative path; also blocks Windows drive/UNC traversal
  if (/^[A-Za-z]:/.test(relativePath)) return false; // drive-relative, e.g. "C:foo"
  if (path.posix.isAbsolute(relativePath)) return false;
  const normalized = path.posix.normalize(relativePath);
  return normalized !== '..' && !normalized.startsWith('../');
}
