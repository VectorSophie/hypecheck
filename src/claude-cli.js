import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
    return { state: 'connected', stdout };
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

export async function getPluginDetails(pluginId, options = {}) {
  const result = await runClaude(['plugin', 'details', pluginId], options);
  if (result.state !== 'connected') return result;
  return { state: 'connected', details: result.stdout };
}
