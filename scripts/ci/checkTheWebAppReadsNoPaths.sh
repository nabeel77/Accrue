#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

# The web app deploys with no key and no folder of anybody's. The end to end harness is not the
# app and is never deployed, so it is the one thing under apps/web this does not read.
matches=$(grep -rnE "[A-Z0-9_]+(KEYPAIR_PATH|_DIR)" \
  --include='*.ts' --include='*.tsx' \
  apps/web 2>/dev/null | grep -v '^apps/web/e2e/' || true)

if [ -n "$matches" ]; then
  echo "The web app names a key path or a folder. Neither belongs in anything it deploys with:"
  echo "$matches"
  exit 1
fi

example=$(grep -nE "^[A-Z0-9_]+(KEYPAIR_PATH|_DIR)=" apps/web/.env.example 2>/dev/null || true)
if [ -n "$example" ]; then
  echo "apps/web/.env.example names a key path or a folder:"
  echo "$example"
  exit 1
fi

echo "The web app reads no key path and no folder, in code or in its own example file."
