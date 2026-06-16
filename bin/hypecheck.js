#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Pick up GITHUB_TOKEN (and friends) from a local .env without --env-file.
// Node >=20.12; older runtimes simply skip it.
try { process.loadEnvFile(); } catch { /* no .env or unsupported runtime */ }

import { evaluateCandidate } from '../src/evaluate.js';
import { scanLocalContext } from '../src/local-context.js';
import { renderMarkdownReport } from '../src/report.js';

export async function runCli(argv, options = {}) {
  const stdout = options.stdout ?? ((text) => process.stdout.write(text));
  const stderr = options.stderr ?? ((text) => process.stderr.write(text));

  const args = [...argv];
  const command = args.shift();
  const json = removeFlag(args, '--json');
  const noScan = removeFlag(args, '--no-scan');
  const scanOverride = removeOption(args, '--scan');
  const candidate = args.join(' ').trim();

  if (!command || command === '--help' || command === '-h') {
    stdout(usage());
    return 0;
  }

  if (command !== 'eval') {
    stderr(`Unknown command: ${command}\n\n${usage()}`);
    return 2;
  }

  if (!candidate) {
    stderr(`Candidate is required.\n\n${usage()}`);
    return 2;
  }

  const localTools = noScan ? undefined : scanLocalContext({
    cwd: scanOverride ?? options.scanCwd ?? process.cwd(),
    home: options.scanHome ?? os.homedir(),
    fs: options.fsImpl ?? fs,
  });

  try {
    const report = await evaluateCandidate(candidate, { ...options, localTools });
    stdout(json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdownReport(report));
    return ['SKIP', 'REDUNDANT', 'DANGEROUS'].includes(report.verdict) ? 1 : 0;
  } catch (error) {
    stderr(`${error.message}\n`);
    return 3;
  }
}

function removeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function removeOption(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  args.splice(index, 2);
  return value ?? null;
}

function usage() {
  return `Usage:
  hypecheck eval <github-url | npm-package | npm-url | x-twitter-url> [--json] [--no-scan] [--scan <path>]

  --json        emit the structured report instead of Markdown
  --no-scan     skip scanning local Claude Code / dev config for redundancy
  --scan <path> scan this project directory instead of the current one
`;
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
