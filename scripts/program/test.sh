#!/usr/bin/env bash
# Anchor 1.x reaches for surfpool by default. This starts the validator that ships with the
# Solana CLI instead, so the suite runs on any machine that can build the program.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

ledger_directory="test-ledger"
validator_log="${ledger_directory}/validator.log"

rm -rf "$ledger_directory"
mkdir -p "$ledger_directory"

solana-test-validator --reset --quiet --ledger "$ledger_directory" >"$validator_log" 2>&1 &
validator_pid=$!

stop_validator() {
  kill "$validator_pid" 2>/dev/null || true
  wait "$validator_pid" 2>/dev/null || true
}
trap stop_validator EXIT

for _attempt in $(seq 1 60); do
  if solana --url http://127.0.0.1:8899 cluster-version >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! solana --url http://127.0.0.1:8899 cluster-version >/dev/null 2>&1; then
  echo "The local validator did not start. See $validator_log" >&2
  exit 1
fi

solana --url http://127.0.0.1:8899 airdrop 10 >/dev/null 2>&1 || true

anchor test --skip-local-validator "$@"
