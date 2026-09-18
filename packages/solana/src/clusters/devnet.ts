import { address } from '@solana/kit';

import type { ClusterAddresses } from './shape.js';

export const DEVNET: ClusterAddresses = {
  name: 'devnet',
  kaminoLendingProgram: address('7z1AjuAV2Pn5SE2mGsRskYmZw4RTCYXVKwwsf2ydBvmM'),
  kaminoFarmsProgram: address('DqHZVmT1jvqYUDvz2LWyHcxpz9TT2BX88Jnmm1bTp2v8'),
  swapProgram: address('8mFrzd3bJ4Czmi8ee5tJUDmCDLByBaUbP6vUUzpCsYWW'),
  scopeProgram: address('5Dgwh9uaimvaibD6xNxsE2yMRGRvbnq6ssVtTouAhLbA'),
  scopePriceAccount: address('C88HB7ajhR6ZrAawBwt9FV2yFnvQWTYy6Atg6pFSPX9j'),
  lendingMarket: address('DXfxsBp3TZmGLr3GPqGjRwuWZRGLXcBp8bZ6ecX2x8FS'),
  lookupTable: address('9GVJixHWcRbmkabrv1PegZDd16qypep4tEx6f2HMQbS3'),
  mints: {
    USDC: address('BUxHx9ydngE2JjZaCi6NYBPdpLtewo3NVsbq9DBpHjpy'),
    NVDAx: address('7JMviovZ1qEJBhXhVwG9zXqViBpc2cQZs9VN3ABXrpxH'),
    SPYx: address('5xtbHf6eq7GQH2JNc8BP3u1iWA3nY45rh7n6NCcYRYSV'),
    ONyc: address('7aEvt3TXHMEDHfYTguxRbCfxW6XVbBE6rQVqu33h4YnN'),
  },
  reserves: {
    USDC: address('NSYE1BeJDFfyk3rwyPKMUrX4vCvH4DhUXBL39ANHupS'),
    NVDAx: address('23BiiMnHnuu1QQyWE2kKckus5sqDiAiTy9k7PUFK5vUc'),
    SPYx: address('xpnNAZSeFsBManao5zYuTBzan2B6HKgaBzV2BsLtHi4'),
    ONyc: address('DhVcaWL7BxtYq2dTpujo1ChX9HSN3qpx3aved1Ns6mcv'),
  },
};
