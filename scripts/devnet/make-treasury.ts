import { getCreateAccountInstruction } from '@solana-program/system';
import {
  getInitializeAccount3Instruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

import {
  accountOwner,
  adminSigner,
  connectToDevnet,
  mergeIntoRegistry,
  namedSigner,
  readRegistry,
  reportSignature,
  reportStep,
  sendInstructions,
} from './shared.js';

const TOKEN_ACCOUNT_LENGTH = 165n;

const cluster = connectToDevnet();
const admin = await adminSigner();
const registry = readRegistry();
const mint = registry.mints?.['USDC'];
if (mint === undefined) {
  throw new Error('no USDC mint in the registry');
}
const treasury = await namedSigner('treasury-usdc');

if ((await accountOwner(cluster, treasury.address)) === null) {
  const lamports = await cluster.rpc
    .getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_LENGTH)
    .send();
  const signature = await sendInstructions(
    cluster,
    admin,
    [
      getCreateAccountInstruction({
        payer: admin,
        newAccount: treasury,
        lamports,
        space: TOKEN_ACCOUNT_LENGTH,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeAccount3Instruction({
        account: treasury.address,
        mint: mint as never,
        owner: admin.address,
      }),
    ],
    { extraSigners: [treasury] },
  );
  reportSignature('treasury account created', signature);
}
mergeIntoRegistry({ treasury: treasury.address });
reportStep(`treasury ${treasury.address}`);
