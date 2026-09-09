// Evidence-tiered token/context economics analysis: never turns a README
// sentence directly into a numeric score. `computeTokenEconomics` (bottom of
// this file) is the entry point most callers want — the functions above it
// are its independently-testable building blocks.

const SAVINGS_PATTERN = /(?:saves?|reduces?|cuts?|shrinks?)\b[^.\n%]{0,60}?(\d{1,3})\s*%|(\d{1,3})\s*%\s*(?:reduction|savings?|smaller|fewer|less)\b/i;

// Extracts a percentage-based savings claim from free text (a README, a
// package description, etc). Returns { percentage, quote } or null. A
// "claim" here is ONLY ever evidence of what the repo SAYS about itself —
// never treated as a verified number anywhere downstream.
export function extractClaimedSavings(text) {
  if (!text || typeof text !== 'string') return null;

  const match = text.match(SAVINGS_PATTERN);
  if (!match) return null;

  const percentage = Number(match[1] ?? match[2]);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) return null;

  return { percentage, quote: match[0].trim() };
}
