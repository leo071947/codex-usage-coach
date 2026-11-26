#!/bin/bash
set -euo pipefail
codex_bin="${CODEX_CLI_PATH:-$(command -v codex || true)}"
[[ -x "$codex_bin" ]] || { echo 'Set CODEX_CLI_PATH or add codex to PATH.' >&2; exit 1; }
"$codex_bin" plugin remove codex-usage-coach
"$codex_bin" plugin marketplace remove lucky-usage
echo 'Local usage data and the compiled app are retained under CODEX_HOME/usage-coach (default ~/.codex/usage-coach).'
