import path from 'node:path';
import { extractHookEvents } from './extractors.js';
import { resolveLocalScriptPath } from './hook-analysis.js';

export const BOUNDS = {
  maxDepth: 6,
  maxEntries: 500,
  maxFiles: 40,
  maxBytes: 300_000,
  maxRequests: 60,
};

const HOOK_SCRIPT_BOUNDS = { maxScripts: 20, maxBytes: 100_000 };

const RECURSIVE_SIZE_THRESHOLD_KB = 5000;

const INTERESTING = [
  [/(^|\/)\.claude-plugin\/plugin\.json$/, 'plugin'],
  [/(^|\/)\.claude-plugin\/marketplace\.json$/, 'marketplace'],
  [/(^|\/)hooks\/hooks\.json$/, 'hooks'],
  [/(^|\/)hooks\.json$/, 'hooks'],
  [/(^|\/)\.mcp\.json$/, 'mcp'],
  [/(^|\/)(?:\.claude\/)?skills\/[^/]+\/SKILL\.md$/, 'skill'],
  [/(^|\/)(?:\.claude\/)?commands\/[^/]+\.md$/, 'command'],
];

// Shared with src/audit-analyze.js's detectInstructionBombs (which scans
// the local project the CLI is run from, not a fetched candidate repo) so
// the two "does this path look like an adversarial test-fixture" checks
// can't silently drift apart.
export const ADVERSARIAL_DIR_KEYWORDS = 'fixtures?|tests?|__tests__|testdata|examples?|samples?|poc|corpus|malicious|adversarial';

const ADVERSARIAL_CLAUDE_MD = new RegExp(`(^|/)(?:${ADVERSARIAL_DIR_KEYWORDS})/.*CLAUDE\\.md$`, 'i');

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

export async function discoverTree(fetchImpl, repoUrl, headers, { defaultBranch, repoSizeKb = 0, subpath = '' }) {
  const budget = { requests: 0, entries: 0 };
  const skipped = [];
  const found = [];

  async function request(url) {
    budget.requests += 1;
    const response = await fetchImpl(url, headers ? { headers } : undefined);
    if (!response.ok) throw new Error(`discovery fetch failed for ${url}: ${response.status}`);
    return response.json();
  }

  if (repoSizeKb > 0 && repoSizeKb <= RECURSIVE_SIZE_THRESHOLD_KB) {
    let data;
    try {
      data = await request(`${repoUrl}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`);
    } catch {
      return { found, skipped, scanned: [], requestsUsed: budget.requests };
    }

    for (const entry of data.tree ?? []) {
      if (entry.type !== 'blob') continue;

      let relPath = entry.path;
      if (subpath) {
        const prefix = `${subpath}/`;
        if (!relPath.startsWith(prefix)) continue;
        relPath = relPath.slice(prefix.length);
      }

      const fullPath = subpath ? `${subpath}/${relPath}` : relPath;
      const depth = relPath.split('/').length - 1;
      classifyAndCollect({ fullPath, relPath, depth, size: entry.size ?? 0 }, budget, skipped, found);
    }

    return { found, skipped, scanned: found.map((f) => f.path), requestsUsed: budget.requests };
  }

  await walkShallow(request, repoUrl, defaultBranch, subpath, budget, skipped, found);
  return { found, skipped, scanned: found.map((f) => f.path), requestsUsed: budget.requests };
}

function classifyAndCollect({ fullPath, relPath, depth, size }, budget, skipped, found) {
  budget.entries += 1;
  if (depth > BOUNDS.maxDepth) { skipped.push({ path: fullPath, reason: 'depth' }); return; }
  if (budget.entries > BOUNDS.maxEntries) { skipped.push({ path: fullPath, reason: 'count' }); return; }
  const kind = classifyPath(relPath);
  if (!kind) { skipped.push({ path: fullPath, reason: 'not-interesting' }); return; }
  found.push({ path: fullPath, relPath, kind, size, depth });
}

async function walkShallow(request, repoUrl, defaultBranch, subpath, budget, skipped, found) {
  const rootUrl = subpath
    ? `${repoUrl}/contents/${subpath}`
    : `${repoUrl}/git/trees/${encodeURIComponent(defaultBranch)}`;

  const queue = [{ url: rootUrl, prefix: subpath ?? '', depth: 0, viaContents: Boolean(subpath) }];

  while (queue.length > 0) {
    const node = queue.shift();

    if (node.depth > BOUNDS.maxDepth) {
      skipped.push({ path: node.prefix, reason: 'depth' });
      continue;
    }
    if (budget.requests >= BOUNDS.maxRequests) {
      skipped.push({ path: node.prefix, reason: 'requests' });
      continue;
    }

    let children;
    try {
      const data = await request(node.url);
      children = node.viaContents ? data : data.tree;
    } catch {
      continue;
    }

    for (const child of children ?? []) {
      const name = node.viaContents ? child.name : child.path;
      const isDir = node.viaContents ? child.type === 'dir' : child.type === 'tree';
      const childPath = node.prefix ? `${node.prefix}/${name}` : name;

      if (isDir) {
        queue.push({ url: `${repoUrl}/git/trees/${child.sha}`, prefix: childPath, depth: node.depth + 1, viaContents: false });
        continue;
      }

      const relPath = subpath && childPath.startsWith(`${subpath}/`) ? childPath.slice(subpath.length + 1) : childPath;
      classifyAndCollect({ fullPath: childPath, relPath, depth: node.depth, size: child.size ?? 0 }, budget, skipped, found);
    }
  }
}

export async function fetchInterestingFiles(fetchImpl, repoUrl, headers, found) {
  const scanned = [];
  const skipped = [];
  const files = {};
  let bytesUsed = 0;
  let filesUsed = 0;

  // marketplace.json first so callers can expand `source` roots before
  // grouping the rest of the fetched files into components.
  const ordered = [...found].sort((a, b) => (a.kind === 'marketplace' ? -1 : b.kind === 'marketplace' ? 1 : 0));

  for (const entry of ordered) {
    if (filesUsed >= BOUNDS.maxFiles) { skipped.push({ path: entry.path, reason: 'count' }); continue; }
    if (bytesUsed + entry.size > BOUNDS.maxBytes) { skipped.push({ path: entry.path, reason: 'bytes' }); continue; }

    try {
      const response = await fetchImpl(`${repoUrl}/contents/${entry.path}`, headers ? { headers } : undefined);
      if (!response.ok) { skipped.push({ path: entry.path, reason: 'fetch-failed' }); continue; }
      const body = await response.json();
      const text = Buffer.from(body.content ?? '', 'base64').toString('utf8');

      filesUsed += 1;
      bytesUsed += entry.size;
      scanned.push(entry.path);
      files[entry.path] = { kind: entry.kind, text, json: safeJson(text) };
    } catch {
      skipped.push({ path: entry.path, reason: 'fetch-failed' });
    }
  }

  return { files, scanned, skipped, bytesUsed, filesUsed };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Second, independent fetch pass: for each component's parsed hooks
// manifest, try to resolve and fetch the bundled script each hook command
// references (bounded separately from the manifest/skill/command discovery
// budget above — hook scripts are fetched only after components already
// exist, since resolving a script path needs to know the component's root).
// Deliberately does not record scan/skip reasons the way discoverTree does —
// this is a best-effort security-analysis aid, not a discovery-completeness
// concern; a script that can't be fetched just degrades classifyHook to
// command-line-only inference, never a crash or a wrong "safe" conclusion.
export async function fetchHookScripts(fetchImpl, repoUrl, headers, components) {
  for (const component of components) {
    component.hookScripts = {};
    const hookEvents = extractHookEvents(component.manifests);

    let attempts = 0;
    let bytesUsed = 0;

    for (const { command } of hookEvents) {
      if (attempts >= HOOK_SCRIPT_BOUNDS.maxScripts) break;

      const scriptPath = resolveLocalScriptPath(command, component.path);
      if (!scriptPath || Object.hasOwn(component.hookScripts, scriptPath) || !isPathSafe(scriptPath)) continue;

      attempts += 1;

      try {
        const response = await fetchImpl(`${repoUrl}/contents/${scriptPath}`, headers ? { headers } : undefined);
        if (!response.ok) continue;
        const body = await response.json();
        const text = Buffer.from(body.content ?? '', 'base64').toString('utf8');

        if (bytesUsed + text.length > HOOK_SCRIPT_BOUNDS.maxBytes) continue;

        component.hookScripts[scriptPath] = text;
        bytesUsed += text.length;
      } catch {
        continue;
      }
    }
  }

  return components;
}

export async function discoverComponents(fetchImpl, repoUrl, headers, { defaultBranch, repoSizeKb, subpath }) {
  const tree = await discoverTree(fetchImpl, repoUrl, headers, { defaultBranch, repoSizeKb, subpath });
  const contents = await fetchInterestingFiles(fetchImpl, repoUrl, headers, tree.found);

  const marketplaceEntry = tree.found.find((f) => f.kind === 'marketplace');
  const marketplaceFile = marketplaceEntry ? contents.files[marketplaceEntry.path] : null;
  const marketplace = marketplaceFile?.json ?? null;

  const pluginRoots = new Set(
    tree.found.filter((f) => f.kind === 'plugin').map((f) => posixDirname(posixDirname(f.path))),
  );

  if (marketplace && Array.isArray(marketplace.plugins)) {
    for (const entry of marketplace.plugins) {
      if (typeof entry?.source !== 'string' || !entry.source) continue;
      if (!isPathSafe(entry.source)) {
        tree.skipped.push({ path: entry.source, reason: 'path-traversal' });
        continue;
      }
      const normalized = path.posix.normalize(entry.source).replace(/\/+$/, '');
      pluginRoots.add(normalized === '.' || normalized === '' ? '' : normalized);
    }
  }

  if (pluginRoots.size === 0) pluginRoots.add('');

  const roots = [...pluginRoots].sort();
  const components = roots.map((root) => buildComponent(root, contents.files, roots));

  await fetchHookScripts(fetchImpl, repoUrl, headers, components);

  return {
    components,
    marketplace: Boolean(marketplaceEntry),
    scanned: [...tree.scanned, ...contents.scanned],
    skipped: [...tree.skipped, ...contents.skipped],
  };
}

function buildComponent(root, files, knownRoots) {
  const manifests = { plugin: null, hooks: null, mcp: null };
  const skills = [];
  const commands = [];
  const claudeMdHazards = [];

  for (const [filePath, file] of Object.entries(files)) {
    if (assignedRoot(filePath, knownRoots) !== root) continue;
    if (file.kind === 'plugin') manifests.plugin = file.json;
    if (file.kind === 'hooks') manifests.hooks = file.json;
    if (file.kind === 'mcp') manifests.mcp = file.json;
    if (file.kind === 'skill') skills.push(filePath);
    if (file.kind === 'command') commands.push(posixBasename(filePath).replace(/\.md$/, ''));
    if (file.kind === 'adversarial-claude-md') claudeMdHazards.push(filePath);
  }

  return { path: root, manifests, skills, commands, claudeMdHazards };
}

// Every file is owned by the most specific known plugin root that prefixes
// its path; files matching no root belong to the root ('') component.
function assignedRoot(filePath, knownRoots) {
  let best = '';
  for (const root of knownRoots) {
    if (!root) continue;
    if ((filePath === root || filePath.startsWith(`${root}/`)) && root.length > best.length) {
      best = root;
    }
  }
  return best;
}

function posixDirname(p) {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '' : p.slice(0, idx);
}

function posixBasename(p) {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}
