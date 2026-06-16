import { tagCapabilities } from './capabilities.js';

// Scans local Claude Code / dev config for tools the user already has.
// fs/cwd/home are injectable (test seam, mirrors fetchImpl). Network- and,
// in tests, disk-free. ponytail: only enumerable names/ids read, never secrets.

const join = (...parts) => parts.join('/');

// Near-universal script names carry no capability signal — every package has them.
const GENERIC_SCRIPTS = new Set(['test', 'build', 'start', 'dev', 'lint', 'prepare', 'prepublish', 'prepublishOnly', 'postinstall', 'preinstall']);

export function scanLocalContext({ cwd, home, fs } = {}) {
  const tools = [];
  const add = (kind, name, extra = '') => {
    if (!name) return;
    tools.push({ kind, name, tags: tagCapabilities(`${name} ${extra}`) });
  };

  const readJson = (path) => {
    try {
      return JSON.parse(fs.readFileSync(path));
    } catch {
      return null;
    }
  };
  const listDir = (path) => {
    try {
      return fs.readdirSync(path);
    } catch {
      return [];
    }
  };

  const stripExt = (name) => name.replace(/\.[^.]+$/, '');

  const scanMcp = (path) => {
    const json = readJson(path);
    // read only the server keys; never touch env/headers/value blocks
    for (const name of Object.keys(json?.mcpServers ?? {})) add('mcp', name);
  };

  const scanSettings = (path) => {
    const json = readJson(path);
    if (!json) return;
    const plugins = json.enabledPlugins;
    for (const name of Array.isArray(plugins) ? plugins : Object.keys(plugins ?? {})) {
      add('plugin', typeof name === 'string' ? name : name?.name);
    }
    for (const [event, matchers] of Object.entries(json.hooks ?? {})) {
      for (const entry of Array.isArray(matchers) ? matchers : []) {
        const name = entry?.matcher ?? 'hook';
        const command = (entry?.hooks ?? []).map((h) => h?.command ?? '').filter(Boolean).join('; ');
        tools.push({ kind: 'hook', event, name, command, tags: tagCapabilities(name) });
      }
    }
  };

  const scanDir = (path, kind) => {
    for (const entry of listDir(path)) add(kind, stripExt(entry));
  };

  if (cwd) {
    scanMcp(join(cwd, '.mcp.json'));
    scanSettings(join(cwd, '.claude', 'settings.json'));
    scanSettings(join(cwd, '.claude', 'settings.local.json'));
    scanDir(join(cwd, '.claude', 'commands'), 'command');
    scanDir(join(cwd, '.claude', 'skills'), 'skill');

    const pkg = readJson(join(cwd, 'package.json'));
    if (pkg) {
      for (const name of Object.keys(pkg.scripts ?? {})) {
        if (!GENERIC_SCRIPTS.has(name)) add('npm-script', name);
      }
      for (const name of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]) {
        add('dep', name);
      }
    }
  }

  if (home) {
    scanMcp(join(home, '.claude.json'));
    scanSettings(join(home, '.claude', 'settings.json'));
    scanDir(join(home, '.claude', 'commands'), 'command');
    scanDir(join(home, '.claude', 'skills'), 'skill');
    scanDir(join(home, '.claude', 'agents'), 'agent');
  }

  return tools;
}
