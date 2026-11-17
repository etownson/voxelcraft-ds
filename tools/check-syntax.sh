#!/usr/bin/env bash
# Extract the module script from index.html and syntax-check it with node.
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
