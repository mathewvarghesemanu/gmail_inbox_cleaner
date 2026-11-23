#!/usr/bin/env bash
# Builds the Chrome Web Store upload zip from runtime files only.
# Output: release/Gmail_unsubscriber_on_device_v<version>.zip (version read from manifest.json).
set -euo pipefail

# Runtime files shipped in the extension package. Add new runtime files here.
RUNTIME_FILES=(
  manifest.json
  background.js
  styles.css
  popup.html
  popup.js
  popup.css
)
# Globs expanded relative to the repo root.
RUNTIME_GLOBS=(
  "src/*.js"
  "icons/*.png"
)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -n 1)"
if [[ -z "$VERSION" ]]; then
  echo "error: could not read version from manifest.json" >&2
  exit 1
fi

FILES=("${RUNTIME_FILES[@]}")
shopt -s nullglob
for pattern in "${RUNTIME_GLOBS[@]}"; do
  # shellcheck disable=SC2206
  matches=($pattern)
  if [[ ${#matches[@]} -eq 0 ]]; then
    echo "error: no files match $pattern" >&2
    exit 1
  fi
  FILES+=("${matches[@]}")
done
shopt -u nullglob

for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "error: missing runtime file $f" >&2
    exit 1
  fi
done

OUT="release/Gmail_unsubscriber_on_device_v${VERSION}.zip"
mkdir -p release
rm -f "$OUT"
zip -X -q "$OUT" "${FILES[@]}" -x "*.DS_Store"

echo "Built $OUT"
