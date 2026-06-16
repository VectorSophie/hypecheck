const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const NPM_HOSTS = new Set(['npmjs.com', 'www.npmjs.com']);
const SOCIAL_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);

export function normalizeCandidate(input) {
  const original = String(input ?? '').trim();

  if (!original) {
    throw new Error('Candidate is required');
  }

  const url = tryUrl(original);

  if (url) {
    return normalizeUrlCandidate(original, url);
  }

  const bareGithub = original.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (bareGithub && !original.startsWith('@')) {
    const [, owner, repo] = bareGithub;
    return githubCandidate(original, owner, repo);
  }

  if (isLikelyNpmName(original)) {
    return npmCandidate(original, original);
  }

  throw new Error(`Unsupported candidate: ${original}`);
}

function normalizeUrlCandidate(original, url) {
  const host = url.hostname.toLowerCase();
  const pathParts = url.pathname.split('/').filter(Boolean);

  if (GITHUB_HOSTS.has(host) && pathParts.length >= 2) {
    return githubCandidate(original, pathParts[0], stripGitSuffix(pathParts[1]));
  }

  if (NPM_HOSTS.has(host) && pathParts[0] === 'package' && pathParts[1]) {
    const packageName = decodeURIComponent(pathParts.slice(1).join('/'));
    return npmCandidate(original, packageName);
  }

  if (SOCIAL_HOSTS.has(host)) {
    return {
      type: 'social',
      original,
      url: url.toString(),
      canonical: url.toString(),
    };
  }

  throw new Error(`Unsupported candidate URL: ${original}`);
}

function githubCandidate(original, owner, repo) {
  return {
    type: 'github',
    original,
    owner,
    repo,
    canonical: `https://github.com/${owner}/${repo}`,
  };
}

function npmCandidate(original, packageName) {
  return {
    type: 'npm',
    original,
    packageName,
    canonical: `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`,
  };
}

function tryUrl(value) {
  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  const hasKnownHostPrefix = /^(?:github\.com|www\.github\.com|npmjs\.com|www\.npmjs\.com|x\.com|www\.x\.com|twitter\.com|www\.twitter\.com)\//i.test(value);

  if (!hasProtocol && !hasKnownHostPrefix) {
    return null;
  }

  try {
    return new URL(hasProtocol ? value : `https://${value}`);
  } catch {
    return null;
  }
}

function stripGitSuffix(repo) {
  return repo.endsWith('.git') ? repo.slice(0, -4) : repo;
}

function isLikelyNpmName(value) {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(value);
}
