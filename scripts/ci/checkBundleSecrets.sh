#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

bundle_directories=()
[ -d "apps/web/.next/static" ] && bundle_directories+=("apps/web/.next/static")
[ -d "apps/rescue/dist" ] && bundle_directories+=("apps/rescue/dist")

if [ ${#bundle_directories[@]} -eq 0 ]; then
  echo "No browser bundle to check. Run \`pnpm build\` first." >&2
  exit 1
fi

# SOLANA_CLUSTER is not one of these: the app tells the browser which chain it is on, and the
# rescue page picks its own, so the name belongs in a bundle.
server_only_names=$(cat .env.example apps/web/.env.example apps/keeper/.env.example \
  | grep -oE '^[A-Z][A-Z0-9_]*=' \
  | tr -d '=' \
  | grep -v '^NEXT_PUBLIC_' \
  | grep -v '^SOLANA_CLUSTER$' \
  | sort -u)

found_any=0
while IFS= read -r variable_name; do
  [ -z "$variable_name" ] && continue
  if grep -rqF "$variable_name" "${bundle_directories[@]}"; then
    echo "Server only variable name $variable_name appears in a browser bundle."
    found_any=1
  fi
done <<<"$server_only_names"

if [ "$found_any" -eq 1 ]; then
  exit 1
fi

echo "No server only variable name appears in ${bundle_directories[*]}."
