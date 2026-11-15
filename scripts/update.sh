#!/usr/bin/env bash
# Update this clone and re-install for the agents chosen last time.
#   ./scripts/update.sh
# Repos that carry a copy of the skill (init-repo.sh --with-skill) can be refreshed with:
#   ./scripts/init-repo.sh /path/to/app-repo --with-skill
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -d "$ROOT/.git" ]; then
  git -C "$ROOT" pull --ff-only
else
  echo "Not a git clone, skipping git pull"
fi
if [ -s "$ROOT/.install-agents" ]; then
  "$ROOT/scripts/install.sh" --agents "$(cat "$ROOT/.install-agents")"
else
  "$ROOT/scripts/install.sh"
fi
echo
echo "Reminder: in Figma, relaunch the plugin (Plugins > Development > Design Live Bridge) to load the new code."
