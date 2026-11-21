#!/usr/bin/env bash
# Verify both sample banks are present and every file decodes.
#
#   assets/audio/           active CC0 bank, built by tools/build-cc0-bank.py
#   assets/audio-generated/ synthesized fallback/reference, made by
#                           tools/generate-audio.mjs
#
# The game falls back to the procedural synthesizer when the active bank is
# missing, so this is the check that catches a partial commit before GitHub
# Pages serves it.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED=116

if ! command -v ffprobe >/dev/null 2>&1; then
  echo "check-audio: ffprobe not found; skipping decode check" >&2
  exit 0
fi

check_dir() {
  local audio="$1"
  local label="$2"
  local count=0

  if [ ! -d "$audio" ]; then
    echo "check-audio: missing $audio" >&2
    exit 1
  fi

  for file in "$audio"/*.wav; do
    [ -e "$file" ] || { echo "check-audio: no .wav files in $audio" >&2; exit 1; }
    duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$file")"
    if [ -z "$duration" ]; then
      echo "check-audio: cannot decode $(basename "$file")" >&2
      exit 1
    fi
    count=$((count + 1))
  done

  if [ "$count" -ne "$EXPECTED" ]; then
    echo "check-audio: $label expected $EXPECTED files, found $count" >&2
    exit 1
  fi

  size="$(du -sh "$audio" | awk '{print $1}')"
  echo "audio ok: $label, $count files, $size"
}

check_dir "$DIR/assets/audio" "active CC0 bank"

if [ -d "$DIR/assets/audio-generated" ]; then
  check_dir "$DIR/assets/audio-generated" "generated fallback bank"
fi
