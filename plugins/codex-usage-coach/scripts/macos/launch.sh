#!/bin/bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
plugin_root="$(cd "$script_dir/../.." && pwd)"
node_bin="${CODEX_MCP_NODE_PATH:-$(command -v node || true)}"
codex_home="${CODEX_HOME:-$HOME/.codex}"
interval=30
while [[ $# -gt 0 ]]; do
  case "$1" in
    --node) node_bin="$2"; shift 2;;
    --home) codex_home="$2"; shift 2;;
    --interval) interval="$2"; shift 2;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done
[[ -x "$node_bin" ]] || { echo 'Node.js 18+ is required.' >&2; exit 1; }
mkdir -p "$codex_home/usage-coach"
app="$(/bin/bash "$script_dir/build.sh" "$codex_home/usage-coach/runtime" 2>>"$codex_home/usage-coach/mac-build.log")"
exec /usr/bin/open -a "$app" --args --plugin-root "$plugin_root" --node "$node_bin" --home "$codex_home" --interval "$interval"
