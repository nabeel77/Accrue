import { resolve } from 'node:path';

import { test as base, type Page } from '@playwright/test';

import { screenshotDirectory } from './config.js';
import { installTestWallet, loadTestWallet, type TestWalletKeys } from './testWallet.js';

const WALLET_NAME = 'Harness wallet';

export const test = base.extend<{ wallet: TestWalletKeys }>({
  wallet: async ({ page }, use) => {
    const wallet = await loadTestWallet();
    await page.exposeFunction('__accrueE2eSignMessage', async (message: number[]) => [
      ...(await wallet.signMessage(Uint8Array.from(message))),
    ]);
    await page.exposeFunction(
      '__accrueE2eSignTransaction',
      async (transaction: number[]) => [
        ...(await wallet.signTransaction(Uint8Array.from(transaction))),
      ],
    );
    await page.addInitScript(installTestWallet, {
      address: wallet.address,
      publicKeyBytes: wallet.publicKeyBytes,
      name: WALLET_NAME,
    });
    await use(wallet);
  },
});

export const expect = base.expect;

export async function shoot(page: Page, name: string, width: string): Promise<string> {
  const file = `${name}-${width}.png`;
  await page.screenshot({ path: resolve(screenshotDirectory(), file), fullPage: true });
  return file;
}
