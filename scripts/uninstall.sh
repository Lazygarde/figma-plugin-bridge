#!/usr/bin/env bash
# Remove what install.sh installed. Does not touch this clone or any app repo.
#   ./scripts/uninstall.sh                  # every agent
#   ./scripts/uninstall.sh --agents claude  # only some
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_NAME="figma-to-android"
MCP_NAME="figma-to-android-bridge"
SKILL_NAME="figma-to-compose"
AGENTS="antigravity claude codex cursor"
if [ "${1:-}" = "--agents" ]; then AGENTS="$(echo "${2:-}" | tr ',' ' ')"; fi

for a in $AGENTS; do
  case "$a" in
    antigravity)
      d="${AGY_PLUGINS_DIR:-$HOME/.gemini/config/plugins}/$PLUGIN_NAME"
      if [ -d "$d" ]; then rm -rf "$d"; echo "[antigravity] removed $d"; fi
      ;;
    claude)
      rm -rf "$HOME/.claude/skills/$SKILL_NAME"
      command -v claude >/dev/null 2>&1 && claude mcp remove --scope user "$MCP_NAME" >/dev/null 2>&1 || true
      echo "[claude] removed skill and MCP entry (if present)"
      ;;
    codex)
      rm -rf "$HOME/.agents/skills/$SKILL_NAME"
      command -v codex >/dev/null 2>&1 && codex mcp remove "$MCP_NAME" >/dev/null 2>&1 || true
      echo "[codex] removed skill and MCP entry (if present)"
      ;;
    cursor)
      cfg="$HOME/.cursor/mcp.json"
      if [ -f "$cfg" ]; then
        MCP_NAME="$MCP_NAME" node -e '
          const fs = require("fs"); const f = process.argv[1];
          try { const c = JSON.parse(fs.readFileSync(f, "utf8"));
            if (c.mcpServers) delete c.mcpServers[process.env.MCP_NAME];
            fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n"); } catch (e) { console.error("skipped " + f + ": " + e.message); }
        ' "$cfg"
        echo "[cursor] removed MCP entry (if present) from $cfg"
      fi
      ;;
    *) echo "unknown agent: $a" ;;
  esac
done
rm -f "$ROOT/.install-agents"
echo "Also remove the plugin from Figma: Plugins > Development > (plugin) > Remove."
