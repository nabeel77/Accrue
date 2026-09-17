#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

web="apps/web"

# Nothing the app ships may reach into the harness or pull a test runner in.
imports=$(grep -rnE "from ['\"][^'\"]*(e2e/|@playwright/test|playwright)" \
  --include='*.ts' --include='*.tsx' \
  "$web/src" 2>/dev/null || true)

if [ -n "$imports" ]; then
  echo "The app imports test code. Nothing under e2e is part of the app:"
  echo "$imports"
  exit 1
fi

bundle="$web/.next"
if [ -d "$bundle" ]; then
  shipped=$(grep -rl -E "__accrueE2eSign|installTestWallet|@playwright/test" \
    "$bundle/static" "$bundle/server" 2>/dev/null || true)
  if [ -n "$shipped" ]; then
    echo "Test code reached the built app:"
    echo "$shipped"
    exit 1
  fi
  echo "No test code in the built app and no import of the harness from the app."
else
  echo "No import of the harness from the app. Build the app to check its output too."
fi
