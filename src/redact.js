// Deep secret redaction, ported from claude_audit.sh's sanitize_json. Must
// be applied before ANY audit data is rendered, JSON-serialized, snapshotted,
// or included in a thrown error message — this is the one safety net between
// "we read your Claude Code config" and "we might print your API key."

const SENSITIVE_KEY = /token|secret|password|passwd|api[_-]?key|authoriz(?:ation|ed)|credential|cookie|private[_-]?key/i;

// Single canonical list of secret-shaped patterns, used by both redact()
// (whole-value redaction, via the non-global SECRET_SUBSTRING_TEST) and
// redactText() (in-place substring replacement, needs the `g` flag).
// The PEM alternative is deliberately outside the \b(...) group above: \b
// requires a word/non-word transition, and "-" (the first char of a PEM
// header) is non-word, so a \b-anchored alternative would never match a PEM
// block sitting at the very start of a string. It also consumes the WHOLE
// block (header through matching footer, non-greedy across newlines via
// [\s\S]*?) rather than just the header line — redactText() does in-place
// substring replacement, so a header-only match would strip the "BEGIN"
// line and leave the actual base64 key material and footer sitting in
// plaintext right next to it.
const SECRET_SUBSTRING = /\b(?:Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|ghr_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Za-z0-9]{12,})|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)* PRIVATE KEY-----/g;
// Non-global copy for .test() calls — a global regex's .test() advances
// lastIndex as a side effect, which would cause intermittent false
// negatives across redact()'s repeated calls.
const SECRET_SUBSTRING_TEST = new RegExp(SECRET_SUBSTRING.source);

export function redact(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';

  if (Array.isArray(value)) return value.map((v) => redact(v));

  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }

  if (typeof value === 'string' && SECRET_SUBSTRING_TEST.test(value)) return '[REDACTED]';

  return value;
}

// For raw string blobs (CLI stdout/stderr, error messages) where secret-
// shaped substrings might appear anywhere, not just as a whole value under a
// suspicious key.
export function redactText(text) {
  if (typeof text !== 'string') return text;
  return text.replace(SECRET_SUBSTRING, '[REDACTED]');
}
