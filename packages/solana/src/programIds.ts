import { address, type Address } from '@solana/kit';

export { KAMINO_LENDING_PROGRAM_ADDRESS } from './kamino/generated/programs/index.js';

/** The staking program the lending market's reserves carry their farms in. */
export const KAMINO_FARMS_PROGRAM_ADDRESS: Address = address(
  'FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr',
);

/** The swap router every position swap is routed through. */
export const JUPITER_V6_PROGRAM_ADDRESS: Address = address(
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
);

/** The oracle the lending market reads and the guard prices every swap floor against. */
export const SCOPE_PROGRAM_ADDRESS: Address = address(
  'HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ',
);

/** The classic token program, which USDC and the lending market's own collateral tokens use. */
export const TOKEN_PROGRAM_ADDRESS: Address = address(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

/** The token program the stock tokens and their extensions live under. */
export const TOKEN_2022_PROGRAM_ADDRESS: Address = address(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);

/** The program that derives one token account per owner, mint and token program. */
export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS: Address = address(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

/** The sysvar the lending market reads to see the other instructions in a transaction. */
export const INSTRUCTIONS_SYSVAR_ADDRESS: Address = address(
  'Sysvar1nstructions1111111111111111111111111',
);

/** The sysvar an account creation is charged rent against. */
export const RENT_SYSVAR_ADDRESS: Address = address(
  'SysvarRent111111111111111111111111111111111',
);

/** The program that owns every account no other program owns. */
export const SYSTEM_PROGRAM_ADDRESS: Address = address(
  '11111111111111111111111111111111',
);
