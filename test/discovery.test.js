import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNDS, classifyPath, isPathSafe, discoverTree, fetchInterestingFiles, discoverComponents } from '../src/discovery.js';

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 404, async json() { return body; } };
}

function contentsResponse(obj) {
  return jsonResponse({ content: Buffer.from(JSON.stringify(obj)).toString('base64') });
}

test('bounds are the documented constants', () => {
  assert.deepEqual(BOUNDS, {
    maxDepth: 6,
    maxEntries: 500,
    maxFiles: 40,
    maxBytes: 300_000,
    maxRequests: 60,
  });
});

test('classifies plugin, marketplace, hooks, mcp, skill, command, package manifests', () => {
  assert.equal(classifyPath('.claude-plugin/plugin.json'), 'plugin');
  assert.equal(classifyPath('plugins/shunt/.claude-plugin/plugin.json'), 'plugin');
  assert.equal(classifyPath('.claude-plugin/marketplace.json'), 'marketplace');
  assert.equal(classifyPath('hooks/hooks.json'), 'hooks');
  assert.equal(classifyPath('plugins/shunt/hooks/hooks.json'), 'hooks');
  assert.equal(classifyPath('hooks.json'), 'hooks');
  assert.equal(classifyPath('.mcp.json'), 'mcp');
  assert.equal(classifyPath('skills/lint/SKILL.md'), 'skill');
  assert.equal(classifyPath('.claude/skills/lint/SKILL.md'), 'skill');
  assert.equal(classifyPath('commands/deploy.md'), 'command');
  assert.equal(classifyPath('.claude/commands/deploy.md'), 'command');
  assert.equal(classifyPath('package.json'), 'package');
  assert.equal(classifyPath('plugins/shunt/package.json'), 'package');
});

test('classifies adversarial-path CLAUDE.md but not an ordinary one', () => {
  assert.equal(classifyPath('fixtures/malicious_claude_md/CLAUDE.md'), 'adversarial-claude-md');
  assert.equal(classifyPath('test/adversarial/CLAUDE.md'), 'adversarial-claude-md');
  assert.equal(classifyPath('CLAUDE.md'), null);
  assert.equal(classifyPath('docs/CLAUDE.md'), null);
});

test('does not classify unrelated or binary-looking files', () => {
  assert.equal(classifyPath('src/index.js'), null);
  assert.equal(classifyPath('assets/logo.png'), null);
  assert.equal(classifyPath('README.md'), null);
});

test('isPathSafe rejects path-traversal attempts', () => {
  assert.equal(isPathSafe('plugins/shunt'), true);
  assert.equal(isPathSafe('./plugins/shunt'), true);
  assert.equal(isPathSafe('../../etc/passwd'), false);
  assert.equal(isPathSafe('..'), false);
  assert.equal(isPathSafe('/etc/passwd'), false);
  assert.equal(isPathSafe('plugins/../../etc'), false);
});

test('isPathSafe rejects backslash, drive-letter, and UNC traversal', () => {
  assert.equal(isPathSafe('..\\..\\etc\\passwd'), false);
  assert.equal(isPathSafe('foo\\..\\..\\bar'), false);
  assert.equal(isPathSafe('C:\\Windows\\System32'), false);
  assert.equal(isPathSafe('\\\\server\\share\\file'), false);
  assert.equal(isPathSafe('C:foo'), false);
  assert.equal(isPathSafe(''), false);
});

test('discoverTree uses one recursive call for a small repo and finds root manifests', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    assert.equal(url, 'https://api.github.com/repos/o/r/git/trees/main?recursive=1');
    return jsonResponse({
      tree: [
        { path: '.claude-plugin/plugin.json', type: 'blob', size: 200 },
        { path: 'hooks/hooks.json', type: 'blob', size: 150 },
        { path: 'src/index.js', type: 'blob', size: 900 },
        { path: 'src', type: 'tree' },
      ],
    });
  };

  const result = await discoverTree(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 100, subpath: '',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(result.found.map((f) => f.path).sort(), ['.claude-plugin/plugin.json', 'hooks/hooks.json']);
  assert.ok(result.skipped.some((s) => s.path === 'src/index.js' && s.reason === 'not-interesting'));
  assert.equal(result.requestsUsed, 1);
});

test('discoverTree filters and reroots entries under a subpath', async () => {
  const fetchImpl = async () => jsonResponse({
    tree: [
      { path: 'plugins/shunt/.claude-plugin/plugin.json', type: 'blob', size: 200 },
      { path: 'plugins/other/.claude-plugin/plugin.json', type: 'blob', size: 200 },
    ],
  });

  const result = await discoverTree(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 100, subpath: 'plugins/shunt',
  });

  assert.deepEqual(result.found.map((f) => f.path), ['plugins/shunt/.claude-plugin/plugin.json']);
  assert.deepEqual(result.found.map((f) => f.relPath), ['.claude-plugin/plugin.json']);
});

test('discoverTree enforces the depth bound', async () => {
  const deepPath = `${'a/'.repeat(7)}hooks.json`; // depth 7, over maxDepth 6
  const fetchImpl = async () => jsonResponse({
    tree: [{ path: deepPath, type: 'blob', size: 10 }],
  });

  const result = await discoverTree(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 100, subpath: '',
  });

  assert.deepEqual(result.found, []);
  assert.deepEqual(result.skipped, [{ path: deepPath, reason: 'depth' }]);
});

test('discoverTree degrades gracefully when the tree fetch fails', async () => {
  const fetchImpl = async () => jsonResponse(null, false);
  const result = await discoverTree(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 100, subpath: '',
  });
  assert.deepEqual(result.found, []);
  assert.equal(result.requestsUsed, 1);
});

test('discoverTree walks breadth-first for a large repo, following subtree shas', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === 'https://api.github.com/repos/o/r/git/trees/main') {
      return jsonResponse({ tree: [
        { path: 'plugins', type: 'tree', sha: 'sha-plugins' },
        { path: 'README.md', type: 'blob', size: 50 },
      ] });
    }
    if (url === 'https://api.github.com/repos/o/r/git/trees/sha-plugins') {
      return jsonResponse({ tree: [
        { path: 'shunt', type: 'tree', sha: 'sha-shunt' },
      ] });
    }
    if (url === 'https://api.github.com/repos/o/r/git/trees/sha-shunt') {
      return jsonResponse({ tree: [
        { path: 'hooks.json', type: 'blob', size: 30 },
      ] });
    }
    throw new Error(`unexpected ${url}`);
  };

  const result = await discoverTree(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 999_999, subpath: '',
  });

  assert.deepEqual(result.found.map((f) => f.path), ['plugins/shunt/hooks.json']);
  assert.equal(calls.length, 3);
});

test('discoverTree roots a shallow walk at an explicit subpath via the contents API', async () => {
  const fetchImpl = async (url) => {
    if (url === 'https://api.github.com/repos/o/r/contents/plugins/shunt') {
      return jsonResponse([
        { name: 'hooks.json', type: 'file', size: 30, sha: 'blob-1' },
        { name: 'scripts', type: 'dir', sha: 'sha-scripts' },
      ]);
    }
    if (url === 'https://api.github.com/repos/o/r/git/trees/sha-scripts') {
      return jsonResponse({ tree: [{ path: 'route.js', type: 'blob', size: 40 }] });
    }
    throw new Error(`unexpected ${url}`);
  };

  const result = await discoverTree(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 999_999, subpath: 'plugins/shunt',
  });

  assert.deepEqual(result.found.map((f) => f.path).sort(), ['plugins/shunt/hooks.json']);
});

test('discoverTree stops issuing requests once the request bound is hit', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (url === 'https://api.github.com/repos/o/r/git/trees/main') {
      // 100 sibling subdirectories at depth 1 — far more than the request
      // budget can fully expand, but well within the depth bound.
      return jsonResponse({
        tree: Array.from({ length: 100 }, (_, i) => ({ path: `d${i}`, type: 'tree', sha: `sha-d${i}` })),
      });
    }
    // Each depth-1 directory has one interesting file and no further subdirectories.
    return jsonResponse({ tree: [{ path: 'hooks.json', type: 'blob', size: 10 }] });
  };

  const result = await discoverTree(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 999_999, subpath: '',
  });

  assert.equal(calls, BOUNDS.maxRequests);
  assert.ok(result.skipped.some((s) => s.reason === 'requests'));
  assert.ok(result.skipped.every((s) => s.reason !== 'depth'), 'this fixture should never hit the depth bound — all nodes are at depth <= 1');
});

test('discoverTree halts shallow-mode traversal at the depth bound, without burning the request budget', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const depth = (url.match(/\/d/g) ?? []).length;
    return jsonResponse({ tree: [
      { path: `hooks-${depth}.json`, type: 'blob', size: 10 },
      { path: 'd', type: 'tree', sha: `${url}/d` },
    ] });
  };

  const result = await discoverTree(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 999_999, subpath: '',
  });

  // Root (depth 0) through depth 6 = 7 directory levels processed = 7 requests,
  // then the depth-7 node is skipped without ever being fetched.
  assert.equal(calls, 7);
  assert.ok(calls < BOUNDS.maxRequests, 'depth bound must stop the walk well before the request bound is reached');
  assert.ok(result.skipped.some((s) => s.reason === 'depth'));
});

test('discoverTree assigns the same depth to a file regardless of recursive- vs shallow-mode discovery', async () => {
  const deepRelPath = `${'d/'.repeat(6)}hooks.json`; // 6 nested directories, depth 6 — the documented boundary

  // Recursive mode: repoSizeKb under the threshold, one tree call.
  const recursiveFetch = async () => jsonResponse({ tree: [{ path: deepRelPath, type: 'blob', size: 10 }] });
  const recursiveResult = await discoverTree(recursiveFetch, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 100, subpath: '',
  });

  // Shallow mode: repoSizeKb over the threshold, walked one directory level at a time.
  const shallowFetch = async (url) => {
    const depth = (url.match(/\/d/g) ?? []).length;
    if (depth < 6) {
      return jsonResponse({ tree: [{ path: 'd', type: 'tree', sha: `${url}/d` }] });
    }
    return jsonResponse({ tree: [{ path: 'hooks.json', type: 'blob', size: 10 }] });
  };
  const shallowResult = await discoverTree(shallowFetch, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 999_999, subpath: '',
  });

  assert.equal(recursiveResult.found.length, 1, 'recursive mode should find the depth-6 file');
  assert.equal(shallowResult.found.length, 1, 'shallow mode should find the same depth-6 file — this is the regression this test guards');
  assert.equal(recursiveResult.found[0].depth, shallowResult.found[0].depth);
  assert.equal(recursiveResult.found[0].depth, 6);
});

test('fetchInterestingFiles fetches and parses classified files', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/contents/.claude-plugin/plugin.json')) return contentsResponse({ name: 'shunt' });
    if (url.endsWith('/contents/hooks/hooks.json')) return contentsResponse({ hooks: { PreToolUse: [] } });
    throw new Error(`unexpected ${url}`);
  };

  const found = [
    { path: '.claude-plugin/plugin.json', relPath: '.claude-plugin/plugin.json', kind: 'plugin', size: 20 },
    { path: 'hooks/hooks.json', relPath: 'hooks/hooks.json', kind: 'hooks', size: 20 },
  ];

  const result = await fetchInterestingFiles(fetchImpl, 'https://api.github.com/repos/o/r', {}, found);

  assert.equal(result.files['.claude-plugin/plugin.json'].json.name, 'shunt');
  assert.ok(result.files['hooks/hooks.json'].json.hooks.PreToolUse);
  assert.deepEqual(result.scanned.sort(), ['.claude-plugin/plugin.json', 'hooks/hooks.json']);
});

test('fetchInterestingFiles stops after the file-count bound', async () => {
  const fetchImpl = async () => contentsResponse({});
  const found = Array.from({ length: 45 }, (_, i) => ({
    path: `commands/c${i}.md`, relPath: `commands/c${i}.md`, kind: 'command', size: 5,
  }));

  const result = await fetchInterestingFiles(fetchImpl, 'https://api.github.com/repos/o/r', {}, found);

  assert.equal(result.filesUsed, 40);
  assert.equal(result.skipped.filter((s) => s.reason === 'count').length, 5);
});

test('fetchInterestingFiles stops after the byte bound', async () => {
  const fetchImpl = async () => contentsResponse({});
  const found = [
    { path: 'a.json', relPath: 'a.json', kind: 'mcp', size: 250_000 },
    { path: 'b.json', relPath: 'b.json', kind: 'mcp', size: 100_000 },
  ];

  const result = await fetchInterestingFiles(fetchImpl, 'https://api.github.com/repos/o/r', {}, found);

  assert.deepEqual(result.scanned, ['a.json']);
  assert.ok(result.skipped.some((s) => s.path === 'b.json' && s.reason === 'bytes'));
});

test('fetchInterestingFiles fetches marketplace.json first', async () => {
  const order = [];
  const fetchImpl = async (url) => { order.push(url); return contentsResponse({}); };
  const found = [
    { path: 'commands/a.md', relPath: 'commands/a.md', kind: 'command', size: 5 },
    { path: '.claude-plugin/marketplace.json', relPath: '.claude-plugin/marketplace.json', kind: 'marketplace', size: 5 },
  ];

  await fetchInterestingFiles(fetchImpl, 'https://api.github.com/repos/o/r', {}, found);

  assert.ok(order[0].endsWith('marketplace.json'));
});

test('discoverComponents: single root plugin, no marketplace', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: '.claude-plugin/plugin.json', type: 'blob', size: 20 },
        { path: 'hooks/hooks.json', type: 'blob', size: 20 },
      ] });
    }
    if (url.endsWith('/contents/.claude-plugin/plugin.json')) return contentsResponse({ name: 'root-plugin' });
    if (url.endsWith('/contents/hooks/hooks.json')) return contentsResponse({ hooks: { PreToolUse: [] } });
    throw new Error(`unexpected ${url}`);
  };

  const result = await discoverComponents(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 10, subpath: '',
  });

  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].path, '');
  assert.equal(result.components[0].manifests.plugin.name, 'root-plugin');
  assert.equal(result.marketplace, false);
});

test('discoverComponents: marketplace with one nested plugin (Shunt regression fixture)', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: '.claude-plugin/marketplace.json', type: 'blob', size: 40 },
        { path: 'plugins/shunt/.claude-plugin/plugin.json', type: 'blob', size: 20 },
        { path: 'plugins/shunt/hooks/hooks.json', type: 'blob', size: 20 },
        { path: 'plugins/shunt/skills/route/SKILL.md', type: 'blob', size: 20 },
      ] });
    }
    if (url.endsWith('/contents/.claude-plugin/marketplace.json')) {
      return contentsResponse({ plugins: [{ name: 'shunt', source: './plugins/shunt' }] });
    }
    if (url.endsWith('/contents/plugins/shunt/.claude-plugin/plugin.json')) return contentsResponse({ name: 'shunt' });
    if (url.endsWith('/contents/plugins/shunt/hooks/hooks.json')) {
      return contentsResponse({ hooks: { PreToolUse: [{ hooks: [{ command: 'node route.js' }] }] } });
    }
    if (url.endsWith('/contents/plugins/shunt/skills/route/SKILL.md')) return { ok: true, status: 200, async json() { return { content: Buffer.from('# Route skill').toString('base64') }; } };
    throw new Error(`unexpected ${url}`);
  };

  const result = await discoverComponents(fetchImpl, 'https://api.github.com/repos/spotify/portal-ai-plugins', {}, {
    defaultBranch: 'main', repoSizeKb: 10, subpath: '',
  });

  assert.equal(result.marketplace, true);
  assert.equal(result.components.length, 1);
  const shunt = result.components[0];
  assert.equal(shunt.path, 'plugins/shunt');
  assert.equal(shunt.manifests.plugin.name, 'shunt');
  assert.equal(shunt.manifests.hooks.hooks.PreToolUse.length, 1);
  assert.deepEqual(shunt.skills, ['plugins/shunt/skills/route/SKILL.md']);
});

test('discoverComponents: multiple plugins in one marketplace stay separate', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: '.claude-plugin/marketplace.json', type: 'blob', size: 40 },
        { path: 'plugins/a/.claude-plugin/plugin.json', type: 'blob', size: 20 },
        { path: 'plugins/b/.claude-plugin/plugin.json', type: 'blob', size: 20 },
      ] });
    }
    if (url.endsWith('/contents/.claude-plugin/marketplace.json')) {
      return contentsResponse({ plugins: [{ name: 'a', source: './plugins/a' }, { name: 'b', source: './plugins/b' }] });
    }
    if (url.endsWith('/contents/plugins/a/.claude-plugin/plugin.json')) return contentsResponse({ name: 'a' });
    if (url.endsWith('/contents/plugins/b/.claude-plugin/plugin.json')) return contentsResponse({ name: 'b' });
    throw new Error(`unexpected ${url}`);
  };

  const result = await discoverComponents(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 10, subpath: '',
  });

  assert.deepEqual(result.components.map((c) => c.path).sort(), ['plugins/a', 'plugins/b']);
});

test('discoverComponents: malformed marketplace.json degrades to no marketplace expansion', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [{ path: '.claude-plugin/marketplace.json', type: 'blob', size: 10 }] });
    }
    if (url.endsWith('/contents/.claude-plugin/marketplace.json')) {
      return { ok: true, status: 200, async json() { return { content: Buffer.from('{not valid json').toString('base64') }; } };
    }
    throw new Error(`unexpected ${url}`);
  };

  const result = await discoverComponents(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 10, subpath: '',
  });

  assert.equal(result.marketplace, true);
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].path, '');
});

test('discoverComponents: path-traversal source is rejected, not followed', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [{ path: '.claude-plugin/marketplace.json', type: 'blob', size: 10 }] });
    }
    if (url.endsWith('/contents/.claude-plugin/marketplace.json')) {
      return contentsResponse({ plugins: [{ name: 'evil', source: '../../etc/passwd' }] });
    }
    throw new Error(`unexpected fetch of ${url}`);
  };

  const result = await discoverComponents(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 10, subpath: '',
  });

  assert.ok(result.skipped.some((s) => s.reason === 'path-traversal'));
  assert.deepEqual(result.components.map((c) => c.path), ['']);
});

test('discoverComponents: marketplace source "." normalizes to the root component, not a phantom one', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: '.claude-plugin/marketplace.json', type: 'blob', size: 40 },
        { path: '.claude-plugin/plugin.json', type: 'blob', size: 20 },
      ] });
    }
    if (url.endsWith('/contents/.claude-plugin/marketplace.json')) {
      return contentsResponse({ plugins: [{ name: 'root-plugin', source: '.' }] });
    }
    if (url.endsWith('/contents/.claude-plugin/plugin.json')) return contentsResponse({ name: 'root-plugin' });
    throw new Error(`unexpected ${url}`);
  };

  const result = await discoverComponents(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 10, subpath: '',
  });

  assert.equal(result.components.length, 1, 'a "." source must not create a second, empty component');
  assert.equal(result.components[0].path, '');
  assert.equal(result.components[0].manifests.plugin.name, 'root-plugin');
});

test('discoverComponents: files are assigned to the most specific of two overlapping roots', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: '.claude-plugin/marketplace.json', type: 'blob', size: 40 },
        { path: 'plugins/.claude-plugin/plugin.json', type: 'blob', size: 20 },
        { path: 'plugins/shunt/.claude-plugin/plugin.json', type: 'blob', size: 20 },
        { path: 'plugins/shunt/hooks/hooks.json', type: 'blob', size: 20 },
        { path: 'plugins/other-file.md', type: 'blob', size: 10 },
      ] });
    }
    if (url.endsWith('/contents/.claude-plugin/marketplace.json')) {
      return contentsResponse({ plugins: [{ name: 'outer', source: './plugins' }, { name: 'shunt', source: './plugins/shunt' }] });
    }
    if (url.endsWith('/contents/plugins/.claude-plugin/plugin.json')) return contentsResponse({ name: 'outer' });
    if (url.endsWith('/contents/plugins/shunt/.claude-plugin/plugin.json')) return contentsResponse({ name: 'shunt' });
    if (url.endsWith('/contents/plugins/shunt/hooks/hooks.json')) return contentsResponse({ hooks: { PreToolUse: [] } });
    throw new Error(`unexpected ${url}`);
  };

  const result = await discoverComponents(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 10, subpath: '',
  });

  assert.deepEqual(result.components.map((c) => c.path).sort(), ['plugins', 'plugins/shunt']);

  const shunt = result.components.find((c) => c.path === 'plugins/shunt');
  const outer = result.components.find((c) => c.path === 'plugins');

  // The file inside plugins/shunt/ must go to the MORE SPECIFIC root, not the outer one.
  assert.ok(shunt.manifests.hooks.hooks.PreToolUse, 'hooks.json under plugins/shunt/ must be assigned to the plugins/shunt component');
  assert.equal(outer.manifests.hooks, null, 'the outer plugins component must NOT also claim the shunt subdirectory\'s hooks.json');
});

test('discoverComponents: subpath-addressed candidate returns just that component', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: 'plugins/shunt/.claude-plugin/plugin.json', type: 'blob', size: 20 },
        { path: 'plugins/other/.claude-plugin/plugin.json', type: 'blob', size: 20 },
      ] });
    }
    if (url.endsWith('/contents/plugins/shunt/.claude-plugin/plugin.json')) return contentsResponse({ name: 'shunt' });
    throw new Error(`unexpected ${url}`);
  };

  const result = await discoverComponents(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 10, subpath: 'plugins/shunt',
  });

  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].manifests.plugin.name, 'shunt');
});

test('discoverComponents: marketplace source with a trailing slash does not create a phantom component', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: '.claude-plugin/marketplace.json', type: 'blob', size: 40 },
        { path: '.claude-plugin/plugin.json', type: 'blob', size: 20 },
      ] });
    }
    if (url.endsWith('/contents/.claude-plugin/marketplace.json')) {
      return contentsResponse({ plugins: [{ name: 'root-plugin', source: './' }] });
    }
    if (url.endsWith('/contents/.claude-plugin/plugin.json')) return contentsResponse({ name: 'root-plugin' });
    throw new Error(`unexpected ${url}`);
  };

  const result = await discoverComponents(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 10, subpath: '',
  });

  assert.equal(result.components.length, 1, 'a "./" source must not create a second, phantom component');
  assert.equal(result.components[0].path, '');
  assert.equal(result.components[0].manifests.plugin.name, 'root-plugin');
});

test('discoverComponents: marketplace source with a nested trailing slash normalizes to match the real root', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('git/trees/main?recursive=1')) {
      return jsonResponse({ tree: [
        { path: '.claude-plugin/marketplace.json', type: 'blob', size: 40 },
        { path: 'plugins/shunt/.claude-plugin/plugin.json', type: 'blob', size: 20 },
        { path: 'plugins/shunt/hooks/hooks.json', type: 'blob', size: 20 },
      ] });
    }
    if (url.endsWith('/contents/.claude-plugin/marketplace.json')) {
      return contentsResponse({ plugins: [{ name: 'shunt', source: 'plugins/shunt/' }] });
    }
    if (url.endsWith('/contents/plugins/shunt/.claude-plugin/plugin.json')) return contentsResponse({ name: 'shunt' });
    if (url.endsWith('/contents/plugins/shunt/hooks/hooks.json')) return contentsResponse({ hooks: { PreToolUse: [] } });
    throw new Error(`unexpected ${url}`);
  };

  const result = await discoverComponents(fetchImpl, 'https://api.github.com/repos/o/r', {}, {
    defaultBranch: 'main', repoSizeKb: 10, subpath: '',
  });

  assert.equal(result.components.length, 1, 'trailing-slash source must merge with the real plugins/shunt root, not create a duplicate');
  assert.equal(result.components[0].path, 'plugins/shunt');
  assert.ok(result.components[0].manifests.hooks.hooks.PreToolUse);
});
