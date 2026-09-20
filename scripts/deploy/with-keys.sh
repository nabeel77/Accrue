#!/bin/sh
set -e

if [ -n "$DEVNET_KEYS_TAR_BASE64" ] && [ -n "$DEVNET_KEYPAIR_DIR" ]; then
  mkdir -p "$DEVNET_KEYPAIR_DIR"
  printf '%s' "$DEVNET_KEYS_TAR_BASE64" | base64 -d | tar -xzf - -C "$DEVNET_KEYPAIR_DIR"
  echo "unpacked $(ls -1 "$DEVNET_KEYPAIR_DIR" | wc -l) key files into $DEVNET_KEYPAIR_DIR"
fi

if [ -n "$ADMIN_KEYPAIR_JSON" ] && [ -n "$ADMIN_KEYPAIR_PATH" ]; then
  mkdir -p "$(dirname "$ADMIN_KEYPAIR_PATH")"
  printf '%s' "$ADMIN_KEYPAIR_JSON" > "$ADMIN_KEYPAIR_PATH"
fi

if [ -n "$KEEPER_KEYPAIR_JSON" ] && [ -n "$KEEPER_KEYPAIR_PATH" ]; then
  mkdir -p "$(dirname "$KEEPER_KEYPAIR_PATH")"
  printf '%s' "$KEEPER_KEYPAIR_JSON" > "$KEEPER_KEYPAIR_PATH"
fi

exec "$@"
