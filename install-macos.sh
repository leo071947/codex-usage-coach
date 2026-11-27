#!/bin/bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo 'This installer is for macOS.' >&2; exit 1; }
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
node_bin="$(command -v node || true)"
[[ -n "$node_bin" ]] || { echo 'Install Node.js 18+ and ensure node is in PATH.' >&2; exit 1; }
"$node_bin" -e 'if(Number(process.versions.node.split(".")[0])<18)process.exit(1)'
codex_bin="${CODEX_CLI_PATH:-$(command -v codex || true)}"
if [[ -z "$codex_bin" && -x /Applications/Codex.app/Contents/Resources/codex ]]; then codex_bin=/Applications/Codex.app/Contents/Resources/codex; fi
[[ -x "$codex_bin" ]] || { echo 'Set CODEX_CLI_PATH to the Codex CLI executable, or add codex to PATH.' >&2; exit 1; }
# Build before registering, so a missing compiler cannot leave a half-installed pet.
data_dir="${CODEX_HOME:-$HOME/.codex}/usage-coach"
mkdir -p "$data_dir"
if ! /bin/bash "$root/plugins/codex-usage-coach/scripts/macos/build.sh" "$data_dir/runtime" 2> >(tee -a "$data_dir/mac-build.log" >&2); then
  echo "Build failed. See $data_dir/mac-build.log" >&2
  exit 1
fi
"$codex_bin" plugin marketplace add "$root" || {
  echo 'Marketplace registration failed. If lucky-usage already exists, continuing with plugin installation.' >&2
}
"$codex_bin" plugin add codex-usage-coach@lucky-usage
"$codex_bin" plugin list
printf '\nInstalled. Reload the plugin in Codex. Grant Codex Usage Cat access in System Settings > Privacy & Security > Accessibility.\n'
