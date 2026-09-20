import {
  adminSigner,
  connectToDevnet,
  namedSigner,
  reportSignature,
  reportStep,
} from './shared.js';
import { readThePoolVaults, topUpThePoolVaultsUnderTheFloor } from './router.js';

async function main(): Promise<void> {
  const cluster = connectToDevnet();
  const admin = await adminSigner();
  const swapProgram = (await namedSigner('honest-swap')).address;

  reportStep(`swap program        ${swapProgram}`);
  for (const vault of await readThePoolVaults(cluster, swapProgram)) {
    reportStep(
      `  vault ${vault.symbol.padEnd(6)} ${vault.vault}  ${vault.wholeUnitsHeld.toFixed(6)}  floor ${vault.floor}${
        vault.isUnderTheFloor ? '  UNDER THE FLOOR' : ''
      }`,
    );
  }

  const { topped, signature } = await topUpThePoolVaultsUnderTheFloor(
    cluster,
    admin,
    swapProgram,
  );
  if (topped.length === 0) {
    reportStep('every vault is above its floor, nothing to do');
    return;
  }
  for (const vault of topped) {
    reportStep(`  topped up ${vault.symbol}`);
  }
  if (signature !== undefined) {
    reportSignature('router vaults topped up', signature);
  }
}

if (process.argv[1]?.endsWith('router-fund.ts') === true) {
  await main();
}
