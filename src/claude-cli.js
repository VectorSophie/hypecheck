import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import nodeFs from 'node:fs';
import { redactText } from './redact.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_BUFFER = 1024 * 1024;

// KNOWN LIMITATION: `claude mcp list`/`get` are deliberately NOT wrapped
// here. Per the reference shell script's own header comment, those commands
// "may start/contact configured MCP servers for health checks" — exactly
// the kind of active probe that must stay behind an explicit opt-in
// (`hypecheck audit --probe`, not yet implemented). Every function in this
// module is safe to call by default.

// Runs a `claude` subcommand safely: shell:false always (no shell injection
// surface), a hard timeout, a bounded output buffer, and NEVER throws — every
// outcome (success, missing binary, crash, timeout) comes back as a tagged
// {state, ...} result the caller can branch on.
async function runClaude(args, options = {}) {
  const execImpl = options.execImpl ?? execFileAsync;

  try {
    const { stdout } = await execImpl('claude', args, {
      shell: false,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
    });
    return { state: 'connected', stdout: String(stdout ?? '') };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { state: 'unavailable', error: 'claude CLI not found in PATH' };
    }
    if (error?.killed || error?.signal === 'SIGTERM') {
      return { state: 'timeout', error: `claude ${args.join(' ')} timed out` };
    }
    return { state: 'failed', error: redactText(String(error?.message ?? error)) };
  }
}

export async function getClaudeVersion(options = {}) {
  const result = await runClaude(['--version'], options);
  if (result.state !== 'connected') return result;
  return { state: 'connected', version: result.stdout.trim() };
}

export async function listPlugins(options = {}) {
  const result = await runClaude(['plugin', 'list', '--json'], options);
  if (result.state !== 'connected') return result;
  try {
    return { state: 'connected', plugins: JSON.parse(result.stdout) };
  } catch {
    return { state: 'failed', error: 'malformed JSON from `claude plugin list --json`' };
  }
}

// `pluginId` is passed as a bare positional argument — shell:false rules out
// shell injection, but a value like `--help` would still be read as a flag
// by the `claude` CLI itself. Safe today because every caller sources
// pluginId from listPlugins()'s own trusted output, never external input.
export async function getPluginDetails(pluginId, options = {}) {
  const result = await runClaude(['plugin', 'details', pluginId], options);
  if (result.state !== 'connected') return result;
  return { state: 'connected', details: result.stdout };
}

// Mirrors src/local-context.js's exact fs-injection convention: plain
// string path-joining (never node:path), since `fs` here is a test seam
// receiving fixture-string paths, not real filesystem paths that need
// platform-correct separators.
const join = (...parts) => parts.join('/');

function readJsonConfig(filePath, fs) {
  try {
    return JSON.parse(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

// Best-effort static config reads — these represent "configured" state
// (what the files SAY), not "recognized"/"enabled" (what the CLI actually
// does with them — that cross-reference happens in the collector, Task 4).
// Never throws; a missing/malformed file is just absent from the result.
export function readClaudeConfigFiles({ cwd, home, fs = nodeFs } = {}) {
  const files = {};
  if (cwd) {
    files.projectSettings = readJsonConfig(join(cwd, '.claude', 'settings.json'), fs);
    files.projectSettingsLocal = readJsonConfig(join(cwd, '.claude', 'settings.local.json'), fs);
    files.projectMcp = readJsonConfig(join(cwd, '.mcp.json'), fs);
  }
  if (home) {
    files.globalSettings = readJsonConfig(join(home, '.claude', 'settings.json'), fs);
    files.globalClaudeJson = readJsonConfig(join(home, '.claude.json'), fs);
  }
  return files;
}
