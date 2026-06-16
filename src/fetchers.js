export async function fetchCandidateData(candidate, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error('No fetch implementation available');
  }

  // GitHub requires a User-Agent and rate-limits unauthenticated calls to 60/hr;
  // a token raises that to 5000/hr. Token is opt-in via options or env.
  const githubHeaders = { 'User-Agent': 'hypecheck' };
  const token = options.githubToken ?? process.env.GITHUB_TOKEN;
  if (token) githubHeaders.Authorization = `Bearer ${token}`;

  if (candidate.type === 'github') {
    return fetchGithubCandidate(candidate, fetchImpl, githubHeaders);
  }

  if (candidate.type === 'npm') {
    return fetchNpmCandidate(candidate, fetchImpl);
  }

  if (candidate.type === 'social') {
    return fetchSocialCandidate(candidate, fetchImpl);
  }

  throw new Error(`Unsupported candidate type: ${candidate.type}`);
}

async function fetchGithubCandidate(candidate, fetchImpl, headers) {
  const repoUrl = `https://api.github.com/repos/${candidate.owner}/${candidate.repo}`;
  const repoResponse = await fetchJson(fetchImpl, repoUrl, headers);

  let readme = '';
  try {
    const readmeResponse = await fetchJson(fetchImpl, `${repoUrl}/readme`, headers);
    readme = decodeBase64(readmeResponse.content ?? '');
  } catch {
    readme = '';
  }

  // Best-effort: pull package.json for lifecycle/shell parity with npm. Many
  // repos won't have one (or it's nested) — a miss is fine, not an error.
  const pkg = await fetchRepoJson(fetchImpl, repoUrl, 'package.json', headers);

  // Real agent-tool config: hooks, MCP servers, plugin manifest. Drives the
  // precise risk findings instead of regex over the README.
  const manifests = {
    plugin: await fetchRepoJson(fetchImpl, repoUrl, '.claude-plugin/plugin.json', headers),
    hooks: await fetchRepoJson(fetchImpl, repoUrl, 'hooks/hooks.json', headers),
    mcp: await fetchRepoJson(fetchImpl, repoUrl, '.mcp.json', headers),
  };

  return {
    source: 'github',
    candidate,
    package: pkg,
    manifests,
    metadata: {
      fullName: repoResponse.full_name,
      description: repoResponse.description ?? '',
      license: repoResponse.license?.spdx_id ?? null,
      stars: repoResponse.stargazers_count ?? 0,
      openIssues: repoResponse.open_issues_count ?? 0,
      pushedAt: repoResponse.pushed_at ?? null,
      defaultBranch: repoResponse.default_branch ?? 'main',
    },
    readme,
  };
}

async function fetchNpmCandidate(candidate, fetchImpl) {
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(candidate.packageName).replace('%2F', '/')}`;
  const registry = await fetchJson(fetchImpl, registryUrl);
  const latestVersion = registry['dist-tags']?.latest;
  const latest = latestVersion ? registry.versions?.[latestVersion] : null;

  return {
    source: 'npm',
    candidate,
    metadata: {
      name: registry.name,
      description: registry.description ?? '',
      license: latest?.license ?? registry.license ?? null,
      latestVersion,
      publishedAt: latestVersion ? registry.time?.[latestVersion] ?? null : null,
      repository: normalizeRepository(latest?.repository ?? registry.repository),
    },
    package: latest ?? {},
    readme: registry.readme ?? '',
  };
}

async function fetchSocialCandidate(candidate, fetchImpl) {
  const response = await fetchImpl(candidate.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch social URL: ${response.status}`);
  }

  return {
    source: 'social',
    candidate,
    html: await response.text(),
  };
}

// Best-effort fetch of a JSON file from the repo's default branch. Returns null
// on any miss (404, not-JSON, etc.) — these files are optional.
async function fetchRepoJson(fetchImpl, repoUrl, path, headers) {
  try {
    const response = await fetchJson(fetchImpl, `${repoUrl}/contents/${path}`, headers);
    return JSON.parse(decodeBase64(response.content ?? ''));
  } catch {
    return null;
  }
}

async function fetchJson(fetchImpl, url, headers) {
  const response = await fetchImpl(url, headers ? { headers } : undefined);
  if (!response.ok) {
    if (response.status === 403 && url.includes('api.github.com')) {
      throw new Error('GitHub API returned 403 (likely the 60/hr unauthenticated rate limit). Set GITHUB_TOKEN to raise it to 5000/hr.');
    }
    throw new Error(`Fetch failed for ${url}: ${response.status}`);
  }
  return response.json();
}

function decodeBase64(value) {
  return Buffer.from(value, 'base64').toString('utf8');
}

function normalizeRepository(repository) {
  if (!repository) return null;
  if (typeof repository === 'string') return repository;
  return repository.url ?? null;
}
