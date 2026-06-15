# Hypecheck MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first local-first Hypecheck slice: a CLI/core that evaluates GitHub/npm/social-link candidates and emits blunt Markdown or structured JSON reports.

**Architecture:** Use a dependency-free Node.js package with focused modules under `src/`. The CLI calls the core evaluator; the evaluator normalizes candidates, fetches public metadata, extracts risk signals, scores the candidate, and renders reports. Claude Code plugin support starts as a plugin-facing slash-command scaffold that invokes the CLI.

**Tech Stack:** Node.js ESM, built-in `node:test`, built-in `fetch`, no runtime dependencies for MVP.

---

### Task 1: Project Scaffold And Candidate Normalization

**Files:**
- Create: `package.json`
- Create: `src/candidate.js`
- Create: `test/candidate.test.js`

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandidate } from '../src/candidate.js';

test('normalizes GitHub HTTPS URLs', () => {
  assert.deepEqual(normalizeCandidate('https://github.com/VectorSophie/hypecheck'), {
    type: 'github',
    original: 'https://github.com/VectorSophie/hypecheck',
    owner: 'VectorSophie',
    repo: 'hypecheck',
    canonical: 'https://github.com/VectorSophie/hypecheck',
  });
});

test('normalizes npm scoped packages', () => {
  assert.deepEqual(normalizeCandidate('@modelcontextprotocol/server-filesystem'), {
    type: 'npm',
    original: '@modelcontextprotocol/server-filesystem',
    packageName: '@modelcontextprotocol/server-filesystem',
    canonical: 'https://www.npmjs.com/package/%40modelcontextprotocol%2Fserver-filesystem',
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test`
Expected: FAIL because `src/candidate.js` does not exist.

- [ ] **Step 3: Implement scaffold and normalizer**

Create package metadata, module files, and candidate normalization for GitHub URLs, npm URLs, npm package names, and X/Twitter links.

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test`
Expected: PASS.

### Task 2: Fetchers And Extractors

**Files:**
- Create: `src/fetchers.js`
- Create: `src/extractors.js`
- Create: `test/fetchers.test.js`

- [ ] **Step 1: Write failing tests**

Test parsing npm metadata, GitHub metadata, package scripts, dependencies, and social-link extraction using injected fetch responses.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test`
Expected: FAIL because fetcher/extractor modules do not exist.

- [ ] **Step 3: Implement fetchers and extractors**

Use injected `fetchImpl` for tests and global `fetch` at runtime. Avoid executing downloaded code.

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test`
Expected: PASS.

### Task 3: Analysis, Scoring, And Reports

**Files:**
- Create: `src/analyze.js`
- Create: `src/score.js`
- Create: `src/report.js`
- Create: `test/analyze.test.js`

- [ ] **Step 1: Write failing tests**

Test lifecycle-script findings, shell execution findings, missing license findings, stale maintenance findings, verdict mapping, and Markdown output.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test`
Expected: FAIL because analyzer/scorer/report modules do not exist.

- [ ] **Step 3: Implement analyzer, scorer, and reporter**

Keep heuristics explicit and evidence-backed. Use serious finding text with blunt summary lines.

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test`
Expected: PASS.

### Task 4: CLI And Plugin Scaffold

**Files:**
- Create: `src/evaluate.js`
- Create: `bin/hypecheck.js`
- Create: `claude-plugin/README.md`
- Create: `claude-plugin/commands/hypecheck.md`
- Create: `test/cli.test.js`

- [ ] **Step 1: Write failing tests**

Test CLI JSON/Markdown behavior and nonzero exit for dangerous reports.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test`
Expected: FAIL because CLI/evaluator files do not exist.

- [ ] **Step 3: Implement evaluator, CLI, and plugin command scaffold**

The plugin command documentation invokes `npx hypecheck eval "$ARGUMENTS"`.

- [ ] **Step 4: Run all verification**

Run: `npm test`
Expected: PASS.

Run: `node bin/hypecheck.js eval @modelcontextprotocol/server-filesystem --json`
Expected: JSON report or fetch error if network is unavailable.
