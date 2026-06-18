#!/usr/bin/env bash
# Pre-commit guard: refuse to commit dotenv files or raw key material.
#
# Receives candidate file paths as arguments (pre-commit pre-filters them via
# the `files`/`exclude` patterns in .pre-commit-config.yaml). We re-check here
# so the script is also correct when run standalone.
set -euo pipefail

blocked=()
for f in "$@"; do
  case "$f" in
    *.env.example|*.env.test) continue ;;            # intended templates
    .env|*/.env|*.env.*|*/.env.*) blocked+=("$f") ;;  # any dotenv file
    *.key) blocked+=("$f") ;;                         # raw key material
  esac
done

if [ "${#blocked[@]}" -gt 0 ]; then
  echo "✋ Refusing to commit secret-bearing file(s):" >&2
  for f in "${blocked[@]}"; do echo "   - $f" >&2; done
  echo >&2
  echo "These must never be tracked. If this is a false positive, adjust the" >&2
  echo "patterns in .pre-commit-config.yaml / scripts/block-secret-files.sh." >&2
  exit 1
fi
