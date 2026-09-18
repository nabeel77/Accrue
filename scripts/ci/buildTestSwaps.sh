#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

# The Solana crates the test programs pull in need a newer cargo than the default toolchain ships.
release="${SOLANA_RELEASE_FOR_TESTS:-4.2.2}"
build_sbf="${TEST_SWAP_BUILD_SBF:-$HOME/.local/share/solana/install/releases/$release/solana-release/bin/cargo-build-sbf}"

if [ ! -x "$build_sbf" ]; then
  build_sbf="cargo-build-sbf"
fi

for program in honest-swap hostile-swap; do
  echo "building $program with $("$build_sbf" --version | head -1)"
  "$build_sbf" --manifest-path "tests/programs/$program/Cargo.toml" --arch v1
done
