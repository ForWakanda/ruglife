#!/usr/bin/env bash
# Hackathon rule: nothing rendered before the bell ships. Every asset in the repo is hashed against the throwaway look-dev set.
# Exit 1 on any match. Run before a submission (and after any art pass).
set -euo pipefail
cd "$(dirname "$0")/.."
SUMS=${PREBELL_SUMS:-$HOME/chogathon-prep/lookdev/SHA256SUMS}
[ -f "$SUMS" ] || { echo "no $SUMS — nothing to check against"; exit 0; }
N=0; BAD=0
while IFS= read -r f; do
  N=$((N+1)); h=$(sha256sum "$f" | cut -d' ' -f1)
  if grep -q "^$h " "$SUMS"; then echo "⛔ pre-bell asset in the repo: $f"; BAD=$((BAD+1)); fi
done < <(git ls-files -- '*.png' '*.webp' '*.jpg' '*.jpeg' '*.svg' '*.gif' '*.mp3' '*.ogg' '*.wav' '*.mp4'; find packages/client/public -type f ! -path '*/node_modules/*' | sort -u)
echo "checked $N asset files against $(wc -l < "$SUMS") look-dev hashes: $BAD match(es)"
[ "$BAD" = 0 ]
