#!/usr/bin/env bash
# Syntax-check the game's JavaScript with node: the module script in index.html
# plus every module under src/. node --check only parses, so a name imported from
# a module that never exports it is invisible here — tools/check-imports.sh does
# that job.
# Usage: ./tools/check-syntax.sh [file]
set -euo pipefail
FILE="${1:-index.html}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$DIR/$FILE"
OUT="$(mktemp -t voxelcraft-syntax).mjs"
python3 - "$SRC" "$OUT" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
html = open(src, encoding='utf-8').read()
match = re.search(r'<script type="module">(.*?)</script>', html, re.S)
if not match:
    sys.exit('no module script found')
open(out, 'w', encoding='utf-8').write(match.group(1))
PY
node --check "$OUT" && echo "syntax ok: $FILE"
rm -f "$OUT"

shopt -s nullglob
for module in "$DIR"/src/*.js; do
  node --check "$module"
  echo "syntax ok: src/$(basename "$module")"
done
