#!/usr/bin/env bash
# Prepare an Android app repo for the Figma workflow.
#   ./scripts/init-repo.sh [path/to/app-repo] [--with-skill]
#
# - creates design/figma-tokens.json, design/figma-components.json, design/screens.json (never overwrites)
# - appends a short Figma section to the repo's AGENTS.md (idempotent)
# - --with-skill: also copies the skill into <repo>/.agents/skills/ so the repo works for teammates
#   who have not installed the agent plugin (commit it, and keep it in sync with update.sh --repo)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="."
WITH_SKILL=0
for a in "$@"; do
  case "$a" in
    --with-skill) WITH_SKILL=1 ;;
    -*) echo "unknown option: $a"; exit 1 ;;
    *) TARGET="$a" ;;
  esac
done

[ -d "$TARGET" ] || { echo "Directory not found: $TARGET"; exit 1; }
TARGET="$(cd "$TARGET" && pwd)"

mkdir -p "$TARGET/design"
for f in "$ROOT"/templates/design/*.json; do
  name="$(basename "$f")"
  if [ -e "$TARGET/design/$name" ]; then
    echo "keep   design/$name (already exists)"
  else
    cp "$f" "$TARGET/design/$name"
    echo "create design/$name"
  fi
done

MARK="<!-- figma-to-android:begin -->"
AGENTS="$TARGET/AGENTS.md"
if [ -f "$AGENTS" ] && grep -qF "$MARK" "$AGENTS"; then
  echo "keep   AGENTS.md (Figma section already present)"
else
  { [ -f "$AGENTS" ] && echo; cat "$ROOT/templates/AGENTS.snippet.md"; } >> "$AGENTS"
  echo "update AGENTS.md (Figma section added; edit the TODO lines)"
fi

if [ "$WITH_SKILL" -eq 1 ]; then
  SK="$TARGET/.agents/skills/figma-to-compose"
  rm -rf "$SK"
  mkdir -p "$TARGET/.agents/skills"
  cp -R "$ROOT/agent-plugin/skills/figma-to-compose" "$SK"
  echo "copy   .agents/skills/figma-to-compose"
fi

echo
echo "Next: fill design/figma-tokens.json and design/figma-components.json for this project,"
echo "      and edit the TODO lines in AGENTS.md."
