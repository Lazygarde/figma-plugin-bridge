#!/usr/bin/env bash
# Start the bridge manually (normally the MCP server starts it on demand).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/bridge/server.mjs"
