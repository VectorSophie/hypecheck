#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Pick up GITHUB_TOKEN (and friends) from a local .env without --env-file.
// Node >=20.12; older runtimes simply skip it.
try { process.loadEnvFile(); } catch { /* no .env or unsupported runtime */ }

import { evaluateCandidate } from '../src/evaluate.js';
import { scanLocalContext } from '../src/local-context.js';
import { auditSetup } from '../src/audit.js';
import { renderMarkdownReport, renderComparison, renderAudit } from '../src/report.js';
import { explainFinding, FINDING_DOCS } from '../src/finding-docs.js';

const NEGATIVE = new Set(['SKIP', 'REDUNDANT', 'DANGEROUS']);

export async function runCli(argv, options = {}) {
  const stdout = options.stdout ?? ((text) => process.stdout.write(text));
  const stderr = options.stderr ?? ((text) => process.stderr.write(text));

  const args = [...argv];
  const command = args.shift();

  if (!command || command === '--help' || command === '-h') {
    stdout(usage());
    return 0;
  }
  if (command === 'eval') return cmdEval(args, options, stdout, stderr);
  if (command === 'compare') return cmdCompare(args, options, stdout, stderr);
  if (command === 'explain') return cmdExplain(args, stdout, stderr);
  if (command === 'audit') return cmdAudit(args, options, stdout);

  stderr(`Unknown command: ${command}\n\n${usage()}`);
  return 2;
}

function resolveLocalTools(args, options) {
  if (removeFlag(args, '--no-scan')) return undefined;
  return scanLocalContext({
    cwd: removeOption(args, '--scan') ?? options.scanCwd ?? process.cwd(),
    home: options.scanHome ?? os.homedir(),
    fs: options.fsImpl ?? fs,
  });
}

async function cmdEval(args, options, stdout, stderr) {
  const json = removeFlag(args, '--json');
  const track = removeFlag(args, '--track');
  const localTools = resolveLocalTools(args, options);
  const candidate = args.join(' ').trim();
  if (!candidate) {
    stderr(`Candidate is required.\n\n${usage()}`);
    return 2;
  }
  try {
    const report = await evaluateCandidate(candidate, { ...options, localTools, track });
    stdout(json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdownReport(report));
    return NEGATIVE.has(report.verdict) ? 1 : 0;
  } catch (error) {
    stderr(`${error.message}\n`);
    return 3;
  }
}

async function cmdCompare(args, options, stdout, stderr) {
  const json = removeFlag(args, '--json');
  const localTools = resolveLocalTools(args, options);
  const [a, b] = args;
  if (!a || !b) {
    stderr(`compare needs two candidates.\n\n${usage()}`);
    return 2;
  }
  try {
    const ra = await evaluateCandidate(a, { ...options, localTools });
    const rb = await evaluateCandidate(b, { ...options, localTools });
    stdout(json ? `${JSON.stringify({ a: ra, b: rb }, null, 2)}\n` : renderComparison(ra, rb));
    return (NEGATIVE.has(ra.verdict) || NEGATIVE.has(rb.verdict)) ? 1 : 0;
  } catch (error) {
    stderr(`${error.message}\n`);
    return 3;
  }
}

function cmdAudit(args, options, stdout) {
  const localTools = resolveLocalTools(args, options) ?? [];
  const findings = auditSetup(localTools);
  stdout(renderAudit(findings));
  return findings.some((f) => f.severity === 'high') ? 1 : 0;
}

function cmdExplain(args, stdout, stderr) {
  const id = args[0];
  const text = id ? explainFinding(id) : null;
  if (!text) {
    stderr(`Unknown finding id: ${id ?? '(none)'}\n\nKnown ids:\n${Object.keys(FINDING_DOCS).map((x) => `  ${x}`).join('\n')}\n`);
    return 2;
  }
  stdout(text);
  return 0;
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
  hypecheck eval <github-url | npm-package | npm-url | x-twitter-url> [--json] [--no-scan] [--scan <path>] [--track]
  hypecheck compare <candidate-a> <candidate-b> [--json] [--no-scan]
  hypecheck explain <finding-id>

  --json        emit the structured report instead of Markdown
  --no-scan     skip scanning local Claude Code / dev config for redundancy
  --scan <path> scan this project directory instead of the current one
  --track       cache this eval and report drift on the next --track run
`;
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
