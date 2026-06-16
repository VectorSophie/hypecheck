// Single source of truth for what each finding means and how to confirm it
// yourself. Powers `hypecheck explain <id>`. Keep an entry for every finding id
// the analyzer can emit.

export const FINDING_DOCS = {
  'npm-lifecycle-script': {
    why: 'install/postinstall/prepare scripts run arbitrary code on your machine the moment you install — a classic supply-chain vector.',
    verify: 'open package.json and read the "scripts" block; check what preinstall/install/postinstall/prepare actually run.',
  },
  'shell-execution-dependency': {
    why: 'a dependency that spawns shell/child processes can run anything; combined with untrusted input it is a code-execution path.',
    verify: 'grep the source for the named dependency (execa, shelljs, zx, cross-spawn, child_process) and see what commands it builds.',
  },
  'missing-license': {
    why: 'no license means no granted rights and usually no maintenance commitment — a weak-trust signal, not a direct danger.',
    verify: 'check the repo for a LICENSE file or a "license" field in package.json.',
  },
  'secret-reference': {
    why: 'the README mentions credentials. This is a heads-up that the tool wants secrets, not proof of misuse — low on its own.',
    verify: 'read the setup docs: which secret, where it is stored, and whether it is sent anywhere.',
  },
  'shell-capability-mentioned': {
    why: 'the docs describe running shell commands. Capability, not proof — confirm against the actual config.',
    verify: 'find where commands are run (hooks, scripts, MCP tools) and read them.',
  },
  'prompt-injection-pattern': {
    why: 'text contains model-facing override or exfiltration phrasing, a known tool-poisoning vector that can hijack the agent.',
    verify: 'read the surrounding text / tool descriptions for instructions aimed at the model rather than the user.',
  },
  'dangerous-hook-event': {
    why: 'the README references a sensitive hook event. When a real manifest is parsed this drops to corroboration; see configured-hook.',
    verify: 'open hooks/hooks.json or plugin.json and confirm whether the hook is actually configured.',
  },
  'agent-tooling-scope': {
    why: 'this affects Claude Code / MCP / hooks / agents, so it carries agent-specific risk beyond a normal package.',
    verify: 'check which surfaces it touches (commands, hooks, MCP servers) in the plugin manifest.',
  },
  'stale-maintenance': {
    why: 'long-dormant tools accumulate unpatched issues and may be abandoned.',
    verify: 'check the latest commit/release date on the repo or registry.',
  },
  'configured-hook': {
    why: 'a committed hook runs a shell command with your full permissions; tool-call events (PreToolUse/PostToolUse) fire constantly.',
    verify: 'open hooks/hooks.json (or the hooks block in plugin.json) and read the command for this event.',
  },
  'shell-in-hook': {
    why: 'a hook command that pipes to a shell or decodes a payload (curl | sh, base64 -d) is a direct remote-code-execution path.',
    verify: 'read the full hook command; trace what the piped/decoded payload does.',
  },
  'mcp-servers': {
    why: 'each bundled MCP server is an external tool surface; several, or any needing credentials, widen the blast radius.',
    verify: 'open .mcp.json (or plugin.json mcpServers) and review each server command and its env requirements.',
  },
  'redundant-installed': {
    why: 'the candidate is already installed locally — installing again adds maintenance with no new capability.',
    verify: 'check your local config for the named tool.',
  },
  'redundant-capability': {
    why: 'a local tool already covers this capability; the candidate may be duplicate workflow.',
    verify: 'compare what the named local tool does against the candidate.',
  },
  'redundant-adjacent': {
    why: 'a local tool covers an adjacent capability; partial overlap worth a glance.',
    verify: 'decide whether the candidate adds something the named local tool lacks.',
  },
  'hook-event-collision': {
    why: 'the candidate hooks an event you already hook locally; both will fire, with possible ordering or conflict surprises.',
    verify: 'compare the candidate hook command with your existing hooks on that event in your .claude config.',
  },
  'mcp-name-collision': {
    why: 'the candidate registers an MCP server name you already use locally; one may shadow the other.',
    verify: 'check your local .mcp.json / ~/.claude.json for the named server.',
  },
  'command-name-collision': {
    why: 'the candidate ships a slash command or skill whose name you already use; one may shadow the other.',
    verify: 'check your local .claude/commands and .claude/skills for the named entry.',
  },
  'maintainer-change': {
    why: 'the package maintainer set changed since you last vetted it — a common rug-pull precursor (ownership transfer before a malicious release).',
    verify: 'check the npm maintainers / recent ownership changes and whether the new maintainer is trusted.',
  },
  'local-redundancy': {
    why: 'you already run multiple local tools covering the same capability — maintenance overhead with no added value.',
    verify: 'review the named local tools and drop the ones you no longer use.',
  },
  'local-hook-collision': {
    why: 'you have multiple hooks on one event; they all fire in config order, which can cause ordering surprises or conflicts.',
    verify: 'open your .claude settings and review the hooks on that event.',
  },
  'local-risky-hook': {
    why: 'a hook you already run executes a shell command with full permissions; worth knowing what is already wired into your setup.',
    verify: 'read the hook command in your .claude settings and confirm you trust it.',
  },
  'drift-detected': {
    why: 'the candidate changed its executable surface since you last vetted it — the rug-pull / post-audit-swap attack class.',
    verify: 're-read the changed hook/MCP config and diff it against what you approved before.',
  },
};

export function explainFinding(id) {
  const doc = FINDING_DOCS[id];
  if (!doc) return null;
  return `${id}\n\nWhy it matters: ${doc.why}\n\nHow to verify: ${doc.verify}\n`;
}
