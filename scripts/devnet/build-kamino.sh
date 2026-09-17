#!/usr/bin/env bash
# Builds our own copies of Kamino's lending and farms programs for devnet, under program ids we
# hold the keys to.
set -euo pipefail

# klend release 1.25.0. Its committed Cargo.lock names the kfarms commit it was built against,
# and that is the commit we check out, so the local patched farms crate is the one klend expects.
KLEND_COMMIT="a08760976f51a3a58c4a0c6ea27b4a0e565bca79"
KFARMS_COMMIT="c2141a40216cfa6f4ca2d272fed351d0b0a0b981"

KLEND_REPOSITORY="https://github.com/Kamino-Finance/klend"
KFARMS_REPOSITORY="https://github.com/Kamino-Finance/kfarms"
KFARMS_DEPENDENCY_SOURCE="https://github.com/Kamino-Finance/kfarms.git"

KLEND_MAINNET_ID="KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
KFARMS_MAINNET_ID="FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"

# Both programs hold state accounts of several kilobytes and build them with Self::default(), which
# needs a stack frame far past the 4,096 bytes the oldest on chain target gives a call. Targeting
# the architecture that sizes frames at run time instead is what makes init_lending_market and
# init_reserve run at all; on the default target they fault the moment they are called. The build
# tools are named by full path so the CLI on the path stays whatever it is.
SOLANA_RELEASE_FOR_KAMINO="4.2.2"
SBF_ARCHITECTURE="v1"

# solana-frozen-abi pins ahash exactly at versions whose source still names a Rust feature that was
# removed after 1.77, so with any current compiler every locked copy has to be patched to build.

LAMPORTS_PER_BYTE=6960
HEADROOM_PERCENT=10
LAMPORTS_PER_SOL=1000000000

devnet_directory="${DEVNET_KEYPAIR_DIR:-$HOME/.config/accrue/devnet}"
source_directory="$devnet_directory/src"

say() {
  printf '%s\n' "$1"
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    say "$1 is not on the path. Install it before running this script."
    exit 1
  fi
}

replace_in_file() {
  local file="$1" search="$2" replacement="$3" temporary
  temporary="$(mktemp)"
  sed "s|$search|$replacement|" "$file" >"$temporary"
  mv "$temporary" "$file"
}

checkout_at_commit() {
  local repository="$1" directory="$2" commit="$3"
  if [ ! -d "$directory/.git" ]; then
    say "cloning $repository"
    git clone --quiet --filter=blob:none "$repository" "$directory"
  fi
  git -C "$directory" fetch --quiet origin "$commit" 2>/dev/null || git -C "$directory" fetch --quiet origin
  git -C "$directory" checkout --quiet --force "$commit"
  git -C "$directory" clean --quiet -fd
}

keypair_for() {
  local name="$1"
  local path="$devnet_directory/$name-keypair.json"
  if [ ! -f "$path" ]; then
    solana-keygen new --no-bip39-passphrase --silent --outfile "$path" >/dev/null
  fi
  printf '%s' "$path"
}

deploy_cost_in_sol() {
  local bytes="$1" lamports
  lamports=$(( bytes * LAMPORTS_PER_BYTE ))
  lamports=$(( lamports + lamports * HEADROOM_PERCENT / 100 ))
  printf '%d.%09d' $(( lamports / LAMPORTS_PER_SOL )) $(( lamports % LAMPORTS_PER_SOL ))
}

for tool in git sed curl tar python3 solana-keygen solana; do
  require_tool "$tool"
done

build_sbf="${KAMINO_BUILD_SBF:-$HOME/.local/share/solana/install/releases/$SOLANA_RELEASE_FOR_KAMINO/solana-release/bin/cargo-build-sbf}"
if [ ! -x "$build_sbf" ]; then
  say "the Solana $SOLANA_RELEASE_FOR_KAMINO build tools are not at $build_sbf."
  say "install them once with:"
  say "  sh -c \"\$(curl -sSfL https://release.anza.xyz/v$SOLANA_RELEASE_FOR_KAMINO/install)\""
  say "then put the active release back with:"
  say "  agave-install init \$(solana --version | awk '{print \$2}')"
  say "or point KAMINO_BUILD_SBF at a cargo-build-sbf that takes --arch $SBF_ARCHITECTURE."
  exit 1
fi

mkdir -p "$source_directory"

klend_keypair="$(keypair_for klend)"
kfarms_keypair="$(keypair_for kfarms)"
klend_id="$(solana address --keypair "$klend_keypair")"
kfarms_id="$(solana address --keypair "$kfarms_keypair")"

klend_directory="$source_directory/klend"
kfarms_directory="$source_directory/kfarms"

checkout_at_commit "$KFARMS_REPOSITORY" "$kfarms_directory" "$KFARMS_COMMIT"
checkout_at_commit "$KLEND_REPOSITORY" "$klend_directory" "$KLEND_COMMIT"

say "patching the program ids"
replace_in_file "$kfarms_directory/programs/kfarms/src/lib.rs" \
  "declare_id!(\"$KFARMS_MAINNET_ID\")" "declare_id!(\"$kfarms_id\")"
replace_in_file "$klend_directory/programs/klend/src/lib.rs" \
  "declare_id!(\"$KLEND_MAINNET_ID\")" "declare_id!(\"$klend_id\")"

if ! grep -q "declare_id!(\"$kfarms_id\")" "$kfarms_directory/programs/kfarms/src/lib.rs"; then
  say "the kfarms declare_id did not change. The pinned commit is not what this script expects."
  exit 1
fi
if ! grep -q "declare_id!(\"$klend_id\")" "$klend_directory/programs/klend/src/lib.rs"; then
  say "the klend declare_id did not change. The pinned commit is not what this script expects."
  exit 1
fi

# klend pins a Rust whose cargo predates the lockfile version klend itself committed, so the pin
# comes out and the build tools choose the toolchain instead.
rm -f "$klend_directory/rust-toolchain.toml" "$kfarms_directory/rust-toolchain.toml"

# Both repositories switch their log macro on target_arch bpf, which was the old on chain target
# name. Today's build tools name it sbf, so every log in both programs compiles to println!, which
# reaches for a standard output that does not exist and faults the moment it runs. target_os solana
# is true on both names, so this is the same switch stated in a way that still holds.
say "pointing the log macros at the target name today's build tools use"
for macros_file in \
  "$klend_directory/programs/klend/src/utils/macros.rs" \
  "$kfarms_directory/programs/kfarms/src/utils/macros.rs"; do
  temporary="$(mktemp)"
  sed 's/target_arch = "bpf"/target_os = "solana"/g' "$macros_file" >"$temporary"
  mv "$temporary" "$macros_file"
  if grep -q 'target_arch = "bpf"' "$macros_file"; then
    say "the log macros in $macros_file did not change."
    exit 1
  fi
done

vendor_directory="$source_directory/vendor"
mkdir -p "$vendor_directory"

vendor_one_ahash() {
  local version="$1" directory="$vendor_directory/ahash-$1" archive
  if [ ! -d "$directory" ]; then
    archive="$(mktemp)"
    curl --silent --show-error --location --fail \
      "https://static.crates.io/crates/ahash/ahash-$version.crate" --output "$archive"
    tar -xzf "$archive" -C "$vendor_directory"
    rm -f "$archive"
  fi
  chmod -R u+w "$directory"
  replace_in_file "$directory/src/lib.rs" \
    '#!\[cfg_attr(feature = "stdsimd", feature(stdsimd))\]' ''
  if grep -q 'feature(stdsimd)' "$directory/src/lib.rs"; then
    say "ahash $version still asks for the removed feature."
    exit 1
  fi
}

# Each repository locks its own ahash versions, so the list comes from its own lockfile rather than
# from a guess here.
patch_ahash_for() {
  local directory="$1" versions version key lines=""
  versions="$(python3 - "$directory/Cargo.lock" <<'VERSIONS'
import re, sys

text = open(sys.argv[1]).read()
found = re.findall(r'name = "ahash"\nversion = "([^"]+)"', text)
print(" ".join(sorted(set(found))))
VERSIONS
)"
  for version in $versions; do
    vendor_one_ahash "$version"
    key="ahash_$(printf '%s' "$version" | tr '.' '_')"
    lines="$lines$key = { path = \"../vendor/ahash-$version\", package = \"ahash\" }
"
  done
  say "  $(basename "$directory") locks ahash $versions"
  python3 - "$directory/Cargo.toml" "$lines" <<'PATCHER'
import sys

manifest, lines = sys.argv[1], sys.argv[2]
text = open(manifest).read()
header = "[patch.crates-io]\n"
text = (
    text.replace(header, header + lines, 1)
    if header in text
    else f"{text}\n{header}{lines}"
)
open(manifest, "w").write(text)
PATCHER
}

say "patching the ahash copies solana-frozen-abi pins"
patch_ahash_for "$kfarms_directory"
patch_ahash_for "$klend_directory"

# klend takes the farms crate straight from git, and it checks the farms program account as
# Program<Farms>, so the id it expects is whatever the farms crate it compiled against declares.
# Pointing the patch at the local checkout is what ties the two ids together.
say "pointing the farms dependency at the patched local checkout"
cat >>"$klend_directory/Cargo.toml" <<PATCH

[patch."$KFARMS_DEPENDENCY_SOURCE"]
farms = { path = "../kfarms/programs/kfarms" }
PATCH


# The lockfile klend committed is a version newer than the build tools' own cargo reads by default.
export CARGO_UNSTABLE_NEXT_LOCKFILE_BUMP=true

# One dependency compiles C in a build script, and the clang inside the build tools carries no
# sysroot for this machine, so host C compilation goes to the system compiler.
system_compiler="$(command -v clang || command -v cc || true)"
if [ -n "$system_compiler" ]; then
  export HOST_CC="$system_compiler"
  export CC_arm64_apple_darwin="$system_compiler"
  export CC_x86_64_unknown_linux_gnu="$system_compiler"
fi

say "building kfarms with the Solana $SOLANA_RELEASE_FOR_KAMINO build tools, architecture $SBF_ARCHITECTURE"
"$build_sbf" --arch "$SBF_ARCHITECTURE" --manifest-path "$kfarms_directory/programs/kfarms/Cargo.toml"
say "building klend with the Solana $SOLANA_RELEASE_FOR_KAMINO build tools, architecture $SBF_ARCHITECTURE"
"$build_sbf" --arch "$SBF_ARCHITECTURE" --manifest-path "$klend_directory/programs/klend/Cargo.toml"

kfarms_binary="$kfarms_directory/target/deploy/farms.so"
klend_binary="$klend_directory/target/deploy/kamino_lending.so"

for binary in "$kfarms_binary" "$klend_binary"; do
  if [ ! -f "$binary" ]; then
    say "$binary was not produced."
    exit 1
  fi
done

# A silent failure here would ship a lending program that still points at the mainnet ids, so the
# binaries are read back and checked against the keys we hold before anything is reported.
say "checking the ids that ended up inside the binaries"
python3 - "$klend_binary" "$kfarms_binary" "$klend_id" "$kfarms_id" \
  "$KLEND_MAINNET_ID" "$KFARMS_MAINNET_ID" <<'CHECK'
import sys

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def decoded(address):
    value = 0
    for character in address:
        value = value * 58 + ALPHABET.index(character)
    return value.to_bytes(32, "big")


lending, farms, lending_id, farms_id, mainnet_lending, mainnet_farms = sys.argv[1:7]
lending_bytes = open(lending, "rb").read()
farms_bytes = open(farms, "rb").read()

problems = []
if decoded(lending_id) not in lending_bytes:
    problems.append("the lending binary does not carry our lending id")
if decoded(farms_id) not in lending_bytes:
    problems.append("the lending binary does not carry our farms id, so the patch did not apply")
if decoded(farms_id) not in farms_bytes:
    problems.append("the farms binary does not carry our farms id")
for name, mainnet in (("lending", mainnet_lending), ("farms", mainnet_farms)):
    if decoded(mainnet) in lending_bytes or decoded(mainnet) in farms_bytes:
        problems.append(f"a mainnet {name} id is still inside a binary")

for problem in problems:
    print(f"  {problem}")
sys.exit(1 if problems else 0)
CHECK

kfarms_bytes="$(wc -c <"$kfarms_binary" | tr -d ' ')"
klend_bytes="$(wc -c <"$klend_binary" | tr -d ' ')"
total_bytes=$(( kfarms_bytes + klend_bytes ))

say ""
say "program ids, from the keypairs in $devnet_directory"
say "  kamino lending  $klend_id"
say "  kamino farms    $kfarms_id"
say ""
say "binaries"
say "  $klend_binary  $klend_bytes bytes"
say "  $kfarms_binary  $kfarms_bytes bytes"
say ""
say "devnet SOL to deploy these two, at $LAMPORTS_PER_BYTE lamports a byte plus $HEADROOM_PERCENT percent"
say "  kamino lending  $(deploy_cost_in_sol "$klend_bytes") SOL"
say "  kamino farms    $(deploy_cost_in_sol "$kfarms_bytes") SOL"
say "  together        $(deploy_cost_in_sol "$total_bytes") SOL"
