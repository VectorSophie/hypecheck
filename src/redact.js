// Deep secret redaction, ported from claude_audit.sh's sanitize_json. Must
// be applied before ANY audit data is rendered, JSON-serialized, snapshotted,
// or included in a thrown error message — this is the one safety net between
// "we read your Claude Code config" and "we might print your API key."

const SENSITIVE_KEY = /token|secret|password|passwd|api[_-]?key|authoriz(?:ation|ed)|credential|cookie|private[_-]?key/i;
const SENSITIVE_VALUE_PREFIX = /^(Bearer\s+|sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[baprs]-|AKIA)/i;

export function redact(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';

  if (Array.isArray(value)) return value.map((v) => redact(v));

  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }

  if (typeof value === 'string' && SENSITIVE_VALUE_PREFIX.test(value)) return '[REDACTED]';

  return value;
}

// For raw string blobs (CLI stdout/stderr, error messages) where secret-
// shaped substrings might appear anywhere, not just as a whole value under a
// suspicious key.
const SECRET_SUBSTRING = /\b(Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|ghr_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Za-z0-9]{12,})/g;

export function redactText(text) {
  if (typeof text !== 'string') return text;
  return text.replace(SECRET_SUBSTRING, '[REDACTED]');
}
