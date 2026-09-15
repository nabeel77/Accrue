/**
 * Version 1 is the format Accrue builds first: 4,096 bytes, no address lookup tables,
 * at most 64 unique addresses, compute limit and priority fee in the message header.
 */
export const PRIMARY_TRANSACTION_VERSION = 1 as const;

/**
 * Every getTransaction, getBlock and simulateTransaction call passes this. An RPC read
 * that omits it fails with error code 32015 as soon as it meets a version 1 transaction.
 */
export const MAX_SUPPORTED_TRANSACTION_VERSION = PRIMARY_TRANSACTION_VERSION;

/** A version 1 message carries every address inline, so the count is capped. */
export const MAX_UNIQUE_ADDRESSES_PER_TRANSACTION = 64;

/** The serialised size limit a version 1 transaction may not exceed. */
export const MAX_TRANSACTION_SIZE_BYTES = 4096;

/** The serialised size limit of the legacy and version 0 formats, used by the fallback path. */
export const MAX_LEGACY_TRANSACTION_SIZE_BYTES = 1232;

export const FALLBACK_TRANSACTION_VERSION = 0 as const;

export type SupportedTransactionVersion =
  typeof PRIMARY_TRANSACTION_VERSION | typeof FALLBACK_TRANSACTION_VERSION;

/**
 * Wallet Standard reports the versions a wallet will sign. A wallet installed before the
 * upgrade will not list 1, and the assembler has to fall back rather than offer bytes the
 * wallet cannot sign.
 */
export function chooseTransactionVersion(
  versionsTheWalletSupports: readonly (number | 'legacy')[],
): SupportedTransactionVersion {
  return versionsTheWalletSupports.includes(PRIMARY_TRANSACTION_VERSION)
    ? PRIMARY_TRANSACTION_VERSION
    : FALLBACK_TRANSACTION_VERSION;
}
