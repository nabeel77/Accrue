import { address, type Address } from '@solana/kit';

import type { ClusterAddresses } from './shape.js';

export const MAINNET: ClusterAddresses = {
  name: 'mainnet',
  kaminoLendingProgram: address('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'),
  kaminoFarmsProgram: address('FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr'),
  swapProgram: address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),
  scopeProgram: address('HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ'),
  scopePriceAccount: address('3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH'),
  lendingMarket: address('5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua'),
  lookupTable: null,
  mints: {
    USDC: address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    NVDAx: address('Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'),
    SPYx: address('XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W'),
    ONyc: address('5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5'),
  },
  reserves: {
    USDC: address('97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E'),
    NVDAx: address('7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q'),
    SPYx: address('UvXjBuC7YZYaGB9Rn1PpBD1GySmjzunXgE8Zev9ua8d'),
    ONyc: address('6ZxkBSJEqsXA3Kdm2PDAzHLUdPTPUK93Lf4bAezec1UQ'),
  },
} as const satisfies { readonly kaminoLendingProgram: Address } & ClusterAddresses;
