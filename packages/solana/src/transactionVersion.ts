export const PRIMARY_TRANSACTION_VERSION = 1 as const;

export const MAX_SUPPORTED_TRANSACTION_VERSION = PRIMARY_TRANSACTION_VERSION;

export const MAX_UNIQUE_ADDRESSES_PER_TRANSACTION = 64;

export const MAX_TRANSACTION_SIZE_BYTES = 4096;

export const MAX_LEGACY_TRANSACTION_SIZE_BYTES = 1232;

export const FALLBACK_TRANSACTION_VERSION = 0 as const;

export type SupportedTransactionVersion =
  typeof PRIMARY_TRANSACTION_VERSION | typeof FALLBACK_TRANSACTION_VERSION;

export function chooseTransactionVersion(
  versionsTheWalletSupports: readonly (number | 'legacy')[],
): SupportedTransactionVersion {
  return versionsTheWalletSupports.includes(PRIMARY_TRANSACTION_VERSION)
    ? PRIMARY_TRANSACTION_VERSION
    : FALLBACK_TRANSACTION_VERSION;
}
