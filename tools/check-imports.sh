#!/usr/bin/env bash
# Checks that every name the game imports is actually exported by the module it
# comes from, and that no module reaches for a name it never imports. node --check
# cannot see either: one is a link error the browser raises at load, the other a
# ReferenceError the first time a player walks into the branch, and with no build
# step there is nothing else to catch them before the page goes blank.
#
# The checks themselves are tools/check-imports.mjs, in the same JavaScript as the
# splitter, because both have to answer the same question — what a file declares,
# what it refers to — with the same rules in tools/js-scope.mjs. Two copies of
# those rules drift apart, and a rule goes stale by stopping to notice a name that
# should have been imported.
# Usage: ./tools/check-imports.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$DIR/tools/check-imports.mjs"
