#!/bin/bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
runtime="${1:-${CODEX_HOME:-$HOME/.codex}/usage-coach/runtime}"
app="$runtime/CodexUsageCat.app"
mkdir -p "$runtime"
if ! /usr/bin/xcrun --find swiftc >/dev/null 2>&1; then
  echo 'Install Xcode Command Line Tools before building the Mac companion (xcode-select --install).' >&2
  exit 1
fi
if [[ -x "$app/Contents/MacOS/CodexUsageCat" && "$app/Contents/MacOS/CodexUsageCat" -nt "$script_dir/CodexCat.swift" && "$app/Contents/Info.plist" -nt "$script_dir/Info.plist" ]]; then
  printf '%s\n' "$app"
  exit 0
fi
lock="$runtime/build.lock"
if ! mkdir "$lock" 2>/dev/null; then
  for ((i=0;i<60;i++)); do
    if [[ ! -d "$lock" ]]; then exec /bin/bash "$script_dir/build.sh" "$runtime"; fi
    sleep 1
  done
  echo "Build busy. Check $lock if a previous build was interrupted." >&2
  exit 1
fi
trap 'rmdir "$lock"' EXIT
mkdir -p "$app/Contents/MacOS"
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$(uname -m)-apple-macosx12.0" -framework AppKit -framework ApplicationServices \
  "$script_dir/CodexCat.swift" -o "$app/Contents/MacOS/CodexUsageCat.next"
mv "$app/Contents/MacOS/CodexUsageCat.next" "$app/Contents/MacOS/CodexUsageCat"
cp "$script_dir/Info.plist" "$app/Contents/Info.plist"
/usr/bin/codesign --force --sign - "$app" >&2
printf '%s\n' "$app"
