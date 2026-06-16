import { normalizeCandidate } from './candidate.js';
import { fetchCandidateData } from './fetchers.js';
import { extractCandidateLinks } from './extractors.js';
import { analyzeCandidate } from './analyze.js';
import { scoreAnalysis } from './score.js';

export async function evaluateCandidate(input, options = {}) {
  const candidate = normalizeCandidate(input);

  if (candidate.type === 'social') {
    const socialData = await fetchCandidateData(candidate, options);
    const links = extractCandidateLinks(socialData.html);
    if (links.length === 0) {
      throw new Error('No GitHub or npm candidate link found in social URL');
    }
    return evaluateCandidate(links[0], options);
  }

  const data = await fetchCandidateData(candidate, options);
  const analysis = analyzeCandidate(data, options);
  return scoreAnalysis(analysis);
}
