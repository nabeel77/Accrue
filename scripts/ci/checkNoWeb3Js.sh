#!/usr/bin/env bash
# Our own code uses @solana/kit. A transitive dependency may still pull the old library in,
# but no file of ours may import it.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

matches=$(grep -rnE "from ['\"]@solana/web3\.js|require\(['\"]@solana/web3\.js" \
  --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.js' \
  apps packages scripts 2>/dev/null || true)

if [ -n "$matches" ]; then
  echo "Found an import of the old Solana library. Use @solana/kit instead:"
  echo "$matches"
  exit 1
fi

echo "No import of the old Solana library under apps, packages or scripts."
