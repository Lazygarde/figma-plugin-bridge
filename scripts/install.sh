#!/usr/bin/env bash
# One-command setup for a developer machine, with an interactive agent picker.
#
#   ./scripts/install.sh                         # choose agents in a menu
#   ./scripts/install.sh --agents claude,codex   # non-interactive
#   ./scripts/install.sh --all                   # every supported agent
#   ./scripts/install.sh --yes                   # no prompt: use detected agents
#
# Always: builds the Figma plugin and installs the bridge dependencies.
# Per selected agent (skill + MCP registration; the bridge starts itself on first tool call):
#   antigravity  plugin in ~/.gemini/config/plugins/figma-to-android (skill + rules + mcp_config.json)
#   claude       skill in ~/.claude/skills/figma-to-compose, MCP via `claude mcp add --scope user`
#   codex        skill in ~/.agents/skills/figma-to-compose, MCP via `codex mcp add`
#   cursor       MCP entry in ~/.cursor/mcp.json (Cursor has no skill folder; use per-repo rules)
#
# Env: AGY_PLUGINS_DIR overrides the Antigravity plugins directory.
# Written for bash 3.2 (macOS default).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_NAME="figma-to-android"
MCP_NAME="figma-to-android-bridge"
SKILL_NAME="figma-to-compose"
AGENT_IDS="antigravity claude codex cursor"
STATE_FILE="$ROOT/.install-agents"

say() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }

agent_label() {
  case "$1" in
    antigravity) echo "Antigravity" ;;
    claude) echo "Claude Code" ;;
    codex) echo "Codex CLI" ;;
    cursor) echo "Cursor (MCP only)" ;;
  esac
}

agent_detected() {
  case "$1" in
    antigravity) [ -d "$HOME/.gemini" ] ;;
    claude) command -v claude >/dev/null 2>&1 || [ -d "$HOME/.claude" ] ;;
    codex) command -v codex >/dev/null 2>&1 || [ -d "$HOME/.codex" ] ;;
    cursor) [ -d "$HOME/.cursor" ] ;;
  esac
}

is_selected() { eval "[ \"\${SEL_$1:-0}\" = 1 ]"; }
set_selected() { eval "SEL_$1=$2"; }
any_selected() { for id in $AGENT_IDS; do is_selected "$id" && return 0; done; return 1; }
valid_agent() { for id in $AGENT_IDS; do [ "$id" = "$1" ] && return 0; done; return 1; }

# ---------- parse arguments ----------
MODE="auto" # auto | list | all | yes
LIST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --agents) LIST="${2:-}"; MODE="list"; shift 2 ;;
    --agents=*) LIST="${1#*=}"; MODE="list"; shift ;;
    --all) MODE="all"; shift ;;
    --yes|-y) MODE="yes"; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (try --help)"; exit 1 ;;
  esac
done

for id in $AGENT_IDS; do set_selected "$id" 0; done

select_detected() {
  for id in $AGENT_IDS; do agent_detected "$id" && set_selected "$id" 1; done
  any_selected || set_selected antigravity 1
}

case "$MODE" in
  list)
    for a in $(echo "$LIST" | tr ',' ' '); do
      valid_agent "$a" || { echo "unknown agent: $a (supported: $AGENT_IDS)"; exit 1; }
      set_selected "$a" 1
    done
    ;;
  all) for id in $AGENT_IDS; do set_selected "$id" 1; done ;;
  yes) select_detected ;;
  auto)
    select_detected
    if [ -t 0 ]; then
      while true; do
        say
        say "Select the AI agents to set up:"
        i=1
        for id in $AGENT_IDS; do
          mark=" "; is_selected "$id" && mark="x"
          det=""; agent_detected "$id" && det="  (detected)"
          printf '  %d) [%s] %s%s\n' "$i" "$mark" "$(agent_label "$id")" "$det"
          i=$((i + 1))
        done
        printf "Toggle by number (e.g. 1 3), a = all, n = none, Enter = confirm: "
        read -r ans || break
        [ -z "$ans" ] && break
        for tok in $ans; do
          case "$tok" in
            a|A) for id in $AGENT_IDS; do set_selected "$id" 1; done ;;
            n|N) for id in $AGENT_IDS; do set_selected "$id" 0; done ;;
            [1-9])
              set -- $AGENT_IDS
              if [ "$tok" -le "$#" ]; then
                eval "id=\${$tok}"
                if is_selected "$id"; then set_selected "$id" 0; else set_selected "$id" 1; fi
              fi
              ;;
          esac
        done
      done
    else
      say "No terminal attached: using detected agents (override with --agents a,b)."
    fi
    ;;
esac

any_selected || { echo "No agent selected, nothing to do."; exit 1; }

SELECTED_LIST=""
for id in $AGENT_IDS; do is_selected "$id" && SELECTED_LIST="$SELECTED_LIST${SELECTED_LIST:+,}$id"; done
say
say "Agents: $SELECTED_LIST"

# ---------- common steps ----------
command -v node >/dev/null || { echo "Node.js >= 18 is required (https://nodejs.org)"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node.js >= 18 is required, found $(node -v)"; exit 1; }

# Stable `node` path from PATH (not the versioned Homebrew Cellar path, which breaks on upgrade).
NODE_BIN="$(command -v node)"
MCP_JS="$ROOT/bridge/mcp.mjs"

say
say "[common] Building the Figma plugin"
(cd "$ROOT" && npm install --no-audit --no-fund --loglevel=error && npm run build --silent)
say "[common] Installing bridge dependencies"
(cd "$ROOT/bridge" && npm install --no-audit --no-fund --loglevel=error)

NOTES=""
add_note() { NOTES="$NOTES
$*"; }

# ---------- per agent ----------
install_antigravity() {
  local dest="${AGY_PLUGINS_DIR:-$HOME/.gemini/config/plugins}/$PLUGIN_NAME"
  say "[antigravity] plugin -> $dest"
  mkdir -p "$dest"
  rm -rf "$dest/skills" "$dest/rules"
  cp "$ROOT/agent-plugin/plugin.json" "$dest/plugin.json"
  cp -R "$ROOT/agent-plugin/skills" "$dest/skills"
  cp -R "$ROOT/agent-plugin/rules" "$dest/rules"
  # MCP server name is prefixed with the plugin name (MCP server names are global).
  MCP_NAME="$MCP_NAME" NODE_BIN="$NODE_BIN" MCP_JS="$MCP_JS" node -e '
    const cfg = { mcpServers: { [process.env.MCP_NAME]: { command: process.env.NODE_BIN, args: [process.env.MCP_JS] } } };
    require("fs").writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2) + "\n");
  ' "$dest/mcp_config.json"
  add_note "Antigravity: open Customizations and check that plugin \"$PLUGIN_NAME\" is enabled."
}

copy_skill_to() {
  local dest="$1"
  rm -rf "$dest/$SKILL_NAME"
  mkdir -p "$dest"
  cp -R "$ROOT/agent-plugin/skills/$SKILL_NAME" "$dest/$SKILL_NAME"
}

install_claude() {
  say "[claude] skill -> ~/.claude/skills/$SKILL_NAME"
  copy_skill_to "$HOME/.claude/skills"
  if command -v claude >/dev/null 2>&1; then
    claude mcp remove --scope user "$MCP_NAME" >/dev/null 2>&1 || true
    if claude mcp add --scope user "$MCP_NAME" -- "$NODE_BIN" "$MCP_JS" >/dev/null 2>&1; then
      say "[claude] MCP server registered (user scope)"
    else
      warn "claude mcp add failed. Run it yourself: claude mcp add --scope user $MCP_NAME -- $NODE_BIN \"$MCP_JS\""
    fi
  else
    add_note "Claude Code: CLI not found. Register the MCP server later with:
    claude mcp add --scope user $MCP_NAME -- $NODE_BIN \"$MCP_JS\""
  fi
  add_note "Claude Code: rules are per repo; run scripts/init-repo.sh and add '@AGENTS.md' to the repo's CLAUDE.md."
}

install_codex() {
  say "[codex] skill -> ~/.agents/skills/$SKILL_NAME"
  copy_skill_to "$HOME/.agents/skills"
  if command -v codex >/dev/null 2>&1; then
    codex mcp remove "$MCP_NAME" >/dev/null 2>&1 || true
    if codex mcp add "$MCP_NAME" -- "$NODE_BIN" "$MCP_JS" >/dev/null 2>&1; then
      say "[codex] MCP server registered"
    else
      warn "codex mcp add failed. Add this to ~/.codex/config.toml yourself (see note below)."
      add_note "Codex: add to ~/.codex/config.toml:
    [mcp_servers.$MCP_NAME]
    command = \"$NODE_BIN\"
    args = [\"$MCP_JS\"]"
    fi
  else
    add_note "Codex: CLI not found. Add to ~/.codex/config.toml:
    [mcp_servers.$MCP_NAME]
    command = \"$NODE_BIN\"
    args = [\"$MCP_JS\"]"
  fi
  add_note "Codex: skill folder path (~/.agents/skills) follows the Codex docs; verify with your Codex version."
}

install_cursor() {
  local cfg="$HOME/.cursor/mcp.json"
  say "[cursor] MCP entry -> $cfg"
  mkdir -p "$HOME/.cursor"
  [ -f "$cfg" ] && [ ! -f "$cfg.bak-figma" ] && cp "$cfg" "$cfg.bak-figma"
  MCP_NAME="$MCP_NAME" NODE_BIN="$NODE_BIN" MCP_JS="$MCP_JS" node -e '
    const fs = require("fs");
    const file = process.argv[1];
    let cfg = {};
    if (fs.existsSync(file)) {
      try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); }
      catch (e) { console.error("cannot parse " + file + ": " + e.message + " (left untouched)"); process.exit(2); }
    }
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers[process.env.MCP_NAME] = { command: process.env.NODE_BIN, args: [process.env.MCP_JS] };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  ' "$cfg" || warn "could not update $cfg; add the MCP server manually"
  add_note "Cursor: has no skill folder. Put the guidance in the repo as .cursor/rules (copy agent-plugin/rules/AGENTS.md and SKILL.md content)."
}

for id in $AGENT_IDS; do
  if is_selected "$id"; then "install_$id"; fi
done

printf '%s\n' "$SELECTED_LIST" > "$STATE_FILE"

cat <<EOF

Done.
$NOTES

The bridge process starts automatically when the agent first calls a figma_* tool.

Figma side (one time per machine):
  1. Open Figma DESKTOP and any design file you may edit/run plugins in.
  2. Menu: Plugins > Development > Import plugin from manifest...
  3. Select: $ROOT/manifest.json
  4. Run "Design Live Bridge" and keep its window open (green dot = connected).

In each app repo:  $ROOT/scripts/init-repo.sh /path/to/app-repo
To update later:   $ROOT/scripts/update.sh
EOF
