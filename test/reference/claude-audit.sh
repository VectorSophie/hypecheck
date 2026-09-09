#!/usr/bin/env bash

# Claude Code setup + token/context audit
# Git Bash / Linux / WSL
#
# Usage:
#   bash claude-audit.sh
#   bash claude-audit.sh /path/to/project
#
# Produces:
#   claude-audit-YYYYMMDD-HHMMSS.txt
#
# This does NOT send prompts to Claude or intentionally invoke a model.
# `claude mcp list/get` may start/contact configured MCP servers for health checks.

set -u

PROJECT_DIR="${1:-$PWD}"
PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd)" || {
    echo "Cannot enter project: $PROJECT_DIR"
    exit 1
}

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$PROJECT_DIR/claude-audit-$STAMP.txt"
TMP_PLUGINS="$(mktemp)"
TMP_MCP="$(mktemp)"

trap 'rm -f "$TMP_PLUGINS" "$TMP_MCP"' EXIT

export NO_COLOR=1

# Print to terminal AND report.
exec > >(tee "$OUT") 2>&1

section() {
    printf '\n\n============================================================\n'
    printf '%s\n' "$1"
    printf '============================================================\n'
}

subsection() {
    printf '\n--- %s ---\n' "$1"
}

run() {
    printf '\n$ '
    printf '%q ' "$@"
    printf '\n'

    "$@"
    local rc=$?

    if [ "$rc" -ne 0 ]; then
        echo "[exit code: $rc]"
    fi

    return 0
}

file_stat() {
    local f="$1"

    [ -f "$f" ] || return 0

    local bytes lines approx
    bytes="$(wc -c < "$f" 2>/dev/null | tr -d ' ')"
    lines="$(wc -l < "$f" 2>/dev/null | tr -d ' ')"

    # VERY rough context estimate. Plugin details below gives Claude's own
    # estimate for plugins; this is just useful for giant markdown files.
    approx=$(( (bytes + 3) / 4 ))

    printf '%8s bytes  %6s lines  ~%6s tokens  %s\n' \
        "$bytes" "$lines" "$approx" "$f"
}

truthy() {
    case "${1,,}" in
        ""|"0"|"false"|"no"|"off") return 1 ;;
        *) return 0 ;;
    esac
}

# ============================================================
# 0. REQUIREMENTS
# ============================================================

section "0. ENVIRONMENT"

echo "Audit time:  $(date)"
echo "Project:     $PROJECT_DIR"
echo "Shell:       ${SHELL:-unknown}"
echo "Git Bash:    ${MSYSTEM:-no}"
echo "OS:          $(uname -a 2>/dev/null || echo unknown)"

if ! command -v claude >/dev/null 2>&1; then
    echo
    echo "ERROR: claude CLI not found in PATH."
    echo "PATH=$PATH"
    exit 1
fi

run claude --version

if command -v node >/dev/null 2>&1; then
    run node --version
else
    echo "Node not found. JSON sanitizing/plugin parsing will be limited."
fi

if command -v uv >/dev/null 2>&1; then
    run uv --version
else
    echo "uv: not installed/found"
fi


# ============================================================
# 1. CLAUDE HEALTH
# ============================================================

section "1. CLAUDE CODE HEALTH"

run claude doctor

subsection "Background-agent daemon"
run claude daemon status


# ============================================================
# 2. TOOL SEARCH / CONTEXT-SAVING SETTINGS
# ============================================================

section "2. MCP TOOL SEARCH"

echo "Relevant environment:"

for var in \
    ENABLE_TOOL_SEARCH \
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS \
    ANTHROPIC_BASE_URL \
    CLAUDE_CODE_SIMPLE \
    CLAUDE_CONFIG_DIR \
    MAX_MCP_OUTPUT_TOKENS \
    MCP_CONNECTION_NONBLOCKING
do
    value="${!var-}"

    if [ -n "$value" ]; then
        # Don't accidentally dump credentials embedded in a proxy URL.
        if [ "$var" = "ANTHROPIC_BASE_URL" ]; then
            value="$(printf '%s' "$value" |
                sed -E 's#(https?://)[^/@]+@#\1[REDACTED]@#')"
        fi

        printf '%-42s = %s\n' "$var" "$value"
    else
        printf '%-42s = <unset>\n' "$var"
    fi
done

echo
echo "Tool Search assessment:"

ETS="${ENABLE_TOOL_SEARCH-}"
BETAS="${CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS-}"
BASE="${ANTHROPIC_BASE_URL-}"

if truthy "$BETAS"; then
    echo "!! TOOL SEARCH LIKELY OFF"
    echo "   CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS is enabled."
elif [ "${ETS,,}" = "false" ]; then
    echo "!! TOOL SEARCH OFF"
    echo "   ENABLE_TOOL_SEARCH=false"
elif [ "${ETS,,}" = "true" ]; then
    echo "OK TOOL SEARCH FORCED ON"
elif [[ "${ETS,,}" == auto* ]]; then
    echo "OK TOOL SEARCH IN THRESHOLD MODE: $ETS"
elif [ -n "$BASE" ] && [ -z "$ETS" ]; then
    echo "!! TOOL SEARCH MAY BE OFF"
    echo "   ANTHROPIC_BASE_URL is custom and ENABLE_TOOL_SEARCH is unset."
else
    echo "OK TOOL SEARCH SHOULD USE CLAUDE'S DEFAULT DEFERRED MODE"
fi


# ============================================================
# 3. SEARCH CONFIG FILES FOR OVERRIDES
# ============================================================

section "3. TOOL SEARCH OVERRIDES IN CONFIG"

CHECK_FILES=(
    "$HOME/.bashrc"
    "$HOME/.bash_profile"
    "$HOME/.profile"
    "$HOME/.zshrc"
    "$HOME/.claude/settings.json"
    "$HOME/.claude/settings.local.json"
    "$PROJECT_DIR/.claude/settings.json"
    "$PROJECT_DIR/.claude/settings.local.json"
    "$PROJECT_DIR/.mcp.json"
)

found_override=0

for f in "${CHECK_FILES[@]}"; do
    [ -f "$f" ] || continue

    matches="$(
        grep -nE \
        'ENABLE_TOOL_SEARCH|CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS|ANTHROPIC_BASE_URL|ToolSearch|alwaysLoad|MAX_MCP_OUTPUT_TOKENS' \
        "$f" 2>/dev/null || true
    )"

    if [ -n "$matches" ]; then
        echo
        echo "[$f]"
        echo "$matches"
        found_override=1
    fi
done

if [ "$found_override" -eq 0 ]; then
    echo "No obvious Tool Search/context overrides found in known config files."
fi


# ============================================================
# 4. MCP INVENTORY
# ============================================================

section "4. MCP SERVERS"

echo '$ claude mcp list'
claude mcp list > "$TMP_MCP" 2>&1
cat "$TMP_MCP"

subsection "Per-server details"

# Claude MCP names are restricted enough that "name:" is safe to parse here.
MCP_NAMES="$(
    sed -nE 's/^([A-Za-z0-9_-]+):.*/\1/p' "$TMP_MCP" |
    sort -u
)"

if [ -z "$MCP_NAMES" ]; then
    echo "No MCP server names could be parsed."
else
    while IFS= read -r name; do
        [ -n "$name" ] || continue

        echo
        echo "### MCP: $name"
        run claude mcp get "$name"
    done <<< "$MCP_NAMES"
fi


# ============================================================
# 5. PLUGIN INVENTORY + CLAUDE'S TOKEN ESTIMATES
# ============================================================

section "5. PLUGINS"

run claude plugin list

subsection "Plugin JSON"

if claude plugin list --json > "$TMP_PLUGINS" 2>/dev/null; then
    cat "$TMP_PLUGINS"
else
    echo "claude plugin list --json unsupported or failed."
    : > "$TMP_PLUGINS"
fi

subsection "Projected token cost / component inventory"

if [ -s "$TMP_PLUGINS" ] && command -v node >/dev/null 2>&1; then

    PLUGIN_NAMES="$(
        node -e '
const fs = require("fs");

let data;
try {
    data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
} catch {
    process.exit(0);
}

let arr = [];

if (Array.isArray(data)) arr = data;
else if (Array.isArray(data.plugins)) arr = data.plugins;
else if (Array.isArray(data.installed)) arr = data.installed;
else if (Array.isArray(data.items)) arr = data.items;

const seen = new Set();

for (const p of arr) {
    if (!p || typeof p !== "object") continue;

    let name =
        p.id ||
        p.fullName ||
        p.full_name ||
        p.name ||
        p.plugin;

    if (typeof name !== "string" || !name) continue;

    // details accepts bare names in normal cases. Keep marketplace suffix
    // when the JSON gives us an explicit one.
    const market =
        p.marketplace ||
        p.marketplaceName ||
        p.sourceMarketplace;

    if (market && !name.includes("@")) {
        name += "@" + market;
    }

    if (!seen.has(name)) {
        seen.add(name);
        console.log(name);
    }
}
' "$TMP_PLUGINS"
    )"

    if [ -z "$PLUGIN_NAMES" ]; then
        echo "Plugin JSON exists, but installed plugin names could not be parsed."
    else
        while IFS= read -r plugin; do
            [ -n "$plugin" ] || continue

            echo
            echo "### PLUGIN: $plugin"
            run claude plugin details "$plugin"
        done <<< "$PLUGIN_NAMES"
    fi
else
    echo "Skipping automatic plugin detail enumeration."
fi


# ============================================================
# 6. CLAUDE.MD / RULES / SKILLS / AGENTS / COMMANDS
# ============================================================

section "6. STATIC CONTEXT FOOTPRINT"

subsection "CLAUDE.md files"

CLAUDE_FILES=(
    "$HOME/.claude/CLAUDE.md"
    "$PROJECT_DIR/CLAUDE.md"
    "$PROJECT_DIR/.claude/CLAUDE.md"
)

any=0
for f in "${CLAUDE_FILES[@]}"; do
    if [ -f "$f" ]; then
        file_stat "$f"
        any=1
    fi
done

# Nested/project-specific CLAUDE.md files, bounded so a monstrous repo
# doesn't turn the audit into archaeology.
while IFS= read -r f; do
    skip=0

    for existing in "${CLAUDE_FILES[@]}"; do
        [ "$f" = "$existing" ] && skip=1
    done

    [ "$skip" -eq 1 ] && continue

    file_stat "$f"
    any=1
done < <(
    find "$PROJECT_DIR" \
        -maxdepth 5 \
        \( -name .git -o -name node_modules -o -name target \
           -o -name .venv -o -name venv \) -prune \
        -o -type f -name CLAUDE.md -print 2>/dev/null
)

[ "$any" -eq 1 ] || echo "No CLAUDE.md files found."


subsection "Rules"

for dir in \
    "$HOME/.claude/rules" \
    "$PROJECT_DIR/.claude/rules"
do
    [ -d "$dir" ] || continue

    find "$dir" -type f -name '*.md' -print0 2>/dev/null |
    while IFS= read -r -d '' f; do
        file_stat "$f"
    done
done


subsection "Skills"

for dir in \
    "$HOME/.claude/skills" \
    "$PROJECT_DIR/.claude/skills"
do
    [ -d "$dir" ] || continue

    find "$dir" -type f -name 'SKILL.md' -print0 2>/dev/null |
    while IFS= read -r -d '' f; do
        file_stat "$f"
    done
done


subsection "Commands"

for dir in \
    "$HOME/.claude/commands" \
    "$PROJECT_DIR/.claude/commands"
do
    [ -d "$dir" ] || continue

    find "$dir" -type f -name '*.md' -print0 2>/dev/null |
    while IFS= read -r -d '' f; do
        file_stat "$f"
    done
done


subsection "Agents"

for dir in \
    "$HOME/.claude/agents" \
    "$PROJECT_DIR/.claude/agents"
do
    [ -d "$dir" ] || continue

    find "$dir" -type f -name '*.md' -print0 2>/dev/null |
    while IFS= read -r -d '' f; do
        file_stat "$f"
    done
done


# ============================================================
# 7. SETTINGS, SANITIZED
# ============================================================

section "7. SANITIZED SETTINGS"

sanitize_json() {
    local f="$1"

    [ -f "$f" ] || return 0

    echo
    echo "### $f"

    if ! command -v node >/dev/null 2>&1; then
        echo "[Node unavailable; not dumping settings to avoid leaking secrets.]"
        return
    fi

    cat "$f" | node -e '
const fs = require("fs");

let obj;

try {
    obj = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
    console.log("[invalid/non-JSON settings file]");
    process.exit(0);
}

const sensitive =
    /token|secret|password|passwd|api.?key|authorization|credential|cookie|private.?key/i;

function scrub(value, key = "") {
    if (sensitive.test(key))
        return "[REDACTED]";

    if (Array.isArray(value))
        return value.map(v => scrub(v));

    if (value && typeof value === "object") {
        const out = {};

        for (const [k, v] of Object.entries(value))
            out[k] = scrub(v, k);

        return out;
    }

    // Catch obvious secret-looking bearer values even under an innocent key.
    if (
        typeof value === "string" &&
        /^(Bearer\s+|sk-|ghp_|github_pat_)/i.test(value)
    )
        return "[REDACTED]";

    return value;
}

console.log(JSON.stringify(scrub(obj), null, 2));
'
}

sanitize_json "$HOME/.claude/settings.json"
sanitize_json "$HOME/.claude/settings.local.json"
sanitize_json "$PROJECT_DIR/.claude/settings.json"
sanitize_json "$PROJECT_DIR/.claude/settings.local.json"
sanitize_json "$PROJECT_DIR/.mcp.json"


# ============================================================
# 8. HOOK SURFACE
# ============================================================

section "8. HOOK SURFACE"

HOOK_PATTERN='PreToolUse|PostToolUse|PostToolUseFailure|UserPromptSubmit|SessionStart|SessionEnd|Stop|SubagentStart|SubagentStop|PreCompact|PostCompact|PermissionRequest|PermissionDenied'

for f in \
    "$HOME/.claude/settings.json" \
    "$HOME/.claude/settings.local.json" \
    "$PROJECT_DIR/.claude/settings.json" \
    "$PROJECT_DIR/.claude/settings.local.json"
do
    [ -f "$f" ] || continue

    matches="$(grep -nE "$HOOK_PATTERN" "$f" 2>/dev/null || true)"

    if [ -n "$matches" ]; then
        echo
        echo "### $f"
        echo "$matches"
    fi
done

echo
echo "Plugin-provided hooks are reported separately by:"
echo "  claude plugin details <plugin>"
echo "and should already appear in section 5."


# ============================================================
# 9. ALWAYS-LOADED MCP CHECK
# ============================================================

section "9. MCP ALWAYS-LOAD CHECK"

for f in \
    "$PROJECT_DIR/.mcp.json" \
    "$HOME/.claude.json"
do
    [ -f "$f" ] || continue

    if grep -q '"alwaysLoad"[[:space:]]*:[[:space:]]*true' "$f" 2>/dev/null; then
        echo "!! alwaysLoad:true found in $f"
        grep -n -B3 -A3 \
            '"alwaysLoad"[[:space:]]*:[[:space:]]*true' \
            "$f" 2>/dev/null |
            sed -E \
                's/(token|secret|password|api[_-]?key)"?[[:space:]]*:[[:space:]]*"[^"]*"/\1":"[REDACTED]"/Ig'
    else
        echo "OK no alwaysLoad:true in $f"
    fi
done


# ============================================================
# 10. SUMMARY HINTS
# ============================================================

section "10. THINGS TO LOOK AT"

cat <<'EOF'
Potential token/context offenders:

  [1] Plugins with high "projected token cost"
  [2] MCP servers using alwaysLoad:true
  [3] ENABLE_TOOL_SEARCH=false
  [4] CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS enabled
  [5] Custom ANTHROPIC_BASE_URL with Tool Search not explicitly enabled
  [6] Huge global CLAUDE.md / rules
  [7] Large numbers of automatically discoverable skills
  [8] Multiple hooks firing on every PreToolUse/PostToolUse
  [9] MCP servers duplicating built-in Claude/CLI functionality
 [10] Dead/failed MCP servers still configured

The ~token counts for Markdown files above are only chars/4 approximations.
Claude's own `plugin details` projected cost is the useful plugin number.
EOF


section "DONE"

echo "Report:"
echo "$OUT"
echo
echo "Paste this report into ChatGPT for the actual pruning pass."