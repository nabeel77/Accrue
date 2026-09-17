import { getCreateAccountInstruction } from '@solana-program/system';
import {
  extension,
  getInitializeMint2Instruction,
  getMintSize,
  getPreInitializeInstructionsForMintExtensions,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Extension,
} from '@solana-program/token-2022';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import type { Address, Instruction, KeyPairSigner } from '@solana/kit';

import {
  accountExists,
  adminSigner,
  connectToDevnet,
  explorerAddressLink,
  mergeIntoRegistry,
  namedSigner,
  reportSignature,
  reportStep,
  sendInstructions,
  type Cluster,
} from './shared.js';
import { SANDBOX_TOKENS, type SandboxToken } from './tokens.js';

const CLASSIC_MINT_LENGTH = 82;

export function mintKeypairName(token: SandboxToken): string {
  return `mint-${token.symbol.toLowerCase()}`;
}

export function tokenProgramAddress(token: SandboxToken): Address {
  return token.tokenProgram === 'token2022'
    ? TOKEN_2022_PROGRAM_ADDRESS
    : TOKEN_PROGRAM_ADDRESS;
}

function extensionsFor(token: SandboxToken, admin: Address): Extension[] {
  if (token.tokenProgram !== 'token2022') {
    return [];
  }
  return [
    extension('PermanentDelegate', { delegate: admin }),
    {
      __kind: 'ScaledUiAmountConfig',
      authority: admin,
      multiplier: token.scaledUiMultiplier ?? 1,
      newMultiplierEffectiveTimestamp: 0n,
      newMultiplier: token.scaledUiMultiplier ?? 1,
    },
  ];
}

async function createOneMint(
  cluster: Cluster,
  admin: KeyPairSigner,
  token: SandboxToken,
): Promise<Address> {
  const mint = await namedSigner(mintKeypairName(token));
  if (await accountExists(cluster, mint.address)) {
    reportStep(`  ${token.symbol.padEnd(6)} ${mint.address}  already there`);
    return mint.address;
  }

  const tokenProgram = tokenProgramAddress(token);
  const extensions = extensionsFor(token, admin.address);
  const space =
    extensions.length > 0 ? BigInt(getMintSize(extensions)) : BigInt(CLASSIC_MINT_LENGTH);
  const lamports = await cluster.rpc.getMinimumBalanceForRentExemption(space).send();

  const instructions: Instruction[] = [
    getCreateAccountInstruction({
      payer: admin,
      newAccount: mint,
      lamports,
      space,
      programAddress: tokenProgram,
    }),
    ...getPreInitializeInstructionsForMintExtensions(mint.address, extensions),
    getInitializeMint2Instruction(
      {
        mint: mint.address,
        decimals: token.decimals,
        mintAuthority: admin.address,
        freezeAuthority: null,
      },
      { programAddress: tokenProgram },
    ),
  ];

  const signature = await sendInstructions(cluster, admin, instructions, {
    extraSigners: [mint],
  });
  reportStep(`  ${token.symbol.padEnd(6)} ${mint.address}  ${token.decimals} decimals`);
  reportSignature(`${token.symbol} mint created`, signature);
  return mint.address;
}

async function main(): Promise<void> {
  const cluster = connectToDevnet();
  const admin = await adminSigner();
  reportStep(`mint authority      ${admin.address}`);

  const mints: Record<string, string> = {};
  for (const token of SANDBOX_TOKENS) {
    mints[token.symbol] = await createOneMint(cluster, admin, token);
  }
  mergeIntoRegistry({ mints, admin: admin.address });

  reportStep('');
  reportStep('mock mints');
  for (const token of SANDBOX_TOKENS) {
    const mint = mints[token.symbol] ?? '';
    reportStep(
      `  ${token.symbol.padEnd(6)} ${mint}  ${token.tokenProgram === 'token2022' ? 'Token 2022, scaled UI amount and permanent delegate' : 'classic token program'}`,
    );
    reportStep(`         ${explorerAddressLink(mint)}`);
  }
}

if (process.argv[1]?.endsWith('mints.ts') === true) {
  await main();
}
