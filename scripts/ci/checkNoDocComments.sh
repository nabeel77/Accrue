#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

# A comment opener is at the start of a line or after a space. A glob inside a string is neither.
matches=$(grep -rnE '(^|[[:space:]])/\*\*' \
  --include='*.ts' --include='*.tsx' \
  apps packages scripts 2>/dev/null \
  | grep -v '/node_modules/' \
  | grep -v '/dist/' \
  | grep -v '/\.next/' \
  | grep -v '^packages/solana/src/program/' \
  | grep -v '^packages/solana/src/kamino/generated/' \
  || true)

if [ -n "$matches" ]; then
  echo "A doc comment is a paragraph nobody reads. One short line with // says as much:"
  echo "$matches"
  exit 1
fi

echo "No doc comment under apps, packages or scripts outside generated code."
