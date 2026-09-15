import { describe, expect, it } from 'vitest';

import {
  chooseTransactionVersion,
  FALLBACK_TRANSACTION_VERSION,
  MAX_SUPPORTED_TRANSACTION_VERSION,
  MAX_TRANSACTION_SIZE_BYTES,
  MAX_UNIQUE_ADDRESSES_PER_TRANSACTION,
  PRIMARY_TRANSACTION_VERSION,
} from './transactionVersion.js';

describe('transaction version', () => {
  it('reads the chain at the version we build', () => {
    expect(MAX_SUPPORTED_TRANSACTION_VERSION).toBe(PRIMARY_TRANSACTION_VERSION);
  });

  it('holds the version 1 limits from the format itself', () => {
    expect(MAX_UNIQUE_ADDRESSES_PER_TRANSACTION).toBe(64);
    expect(MAX_TRANSACTION_SIZE_BYTES).toBe(4096);
  });

  it('builds version 1 for a wallet that advertises it', () => {
    expect(chooseTransactionVersion(['legacy', 0, 1])).toBe(PRIMARY_TRANSACTION_VERSION);
  });

  it('falls back for a wallet installed before the upgrade', () => {
    expect(chooseTransactionVersion(['legacy', 0])).toBe(FALLBACK_TRANSACTION_VERSION);
  });

  it('falls back when a wallet advertises nothing', () => {
    expect(chooseTransactionVersion([])).toBe(FALLBACK_TRANSACTION_VERSION);
  });
});
