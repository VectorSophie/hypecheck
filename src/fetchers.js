export async function fetchCandidateData(candidate, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error('No fetch implementation available');
  }

  if (candidate.type === 'github') {
    return fetchGithubCandidate(candidate, fetchImpl);
  }

  if (candidate.type === 'npm') {
    return fetchNpmCandidate(candidate, fetchImpl);
  }

  if (candidate.type === 'social') {
    return fetchSocialCandidate(candidate, fetchImpl);
  }

  throw new Error(`Unsupported candidate type: ${candidate.type}`);
}

async function fetchGithubCandidate(candidate, fetchImpl) {
  const repoUrl = `https://api.github.com/repos/${candidate.owner}/${candidate.repo}`;
  const repoResponse = await fetchJson(fetchImpl, repoUrl);

  let readme = '';
  try {
    const readmeResponse = await fetchJson(fetchImpl, `${repoUrl}/readme`);
    readme = decodeBase64(readmeResponse.content ?? '');
  } catch {
    readme = '';
  }

  // Best-effort: pull package.json for lifecycle/shell parity with npm. Many
  // repos won't have one (or it's nested) — a miss is fine, not an error.
  let pkg = null;
  try {
    const pkgResponse = await fetchJson(fetchImpl, `${repoUrl}/contents/package.json`);
    pkg = JSON.parse(decodeBase64(pkgResponse.content ?? ''));
  } catch {
    pkg = null;
  }

  return {
    source: 'github',
    candidate,
    package: pkg,
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

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response.ok) {
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
