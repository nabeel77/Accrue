import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import {
  createKeyPairFromBytes,
  getAddressFromPublicKey,
  getBase58Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  signBytes,
  type Address,
} from '@solana/kit';

export interface TestWalletKeys {
  readonly address: Address;
  readonly publicKeyBytes: number[];
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  signTransaction(transaction: Uint8Array): Promise<Uint8Array>;
}

function expand(path: string): string {
  return path.startsWith('~') ? resolve(homedir(), path.slice(2)) : resolve(path);
}

/**
 * One wallet, used for nothing but this run, read from the path in the environment. The admin key
 * is never loaded here and nothing in this folder can reach it.
 */
export async function loadTestWallet(): Promise<TestWalletKeys> {
  const path = process.env['E2E_WALLET_KEYPAIR_PATH'];
  if (path === undefined || path === '') {
    throw new Error('E2E_WALLET_KEYPAIR_PATH is not set. See .env.example.');
  }
  const bytes = Uint8Array.from(
    JSON.parse(await readFile(expand(path), 'utf8')) as number[],
  );
  const keyPair = await createKeyPairFromBytes(bytes);
  const address = await getAddressFromPublicKey(keyPair.publicKey);

  return {
    address,
    publicKeyBytes: [...new Uint8Array(getBase58Encoder().encode(address))],
    async signMessage(message) {
      return new Uint8Array(await signBytes(keyPair.privateKey, message));
    },
    /** Decoded, signed and encoded by the same library the app builds with, never by hand. */
    async signTransaction(transaction) {
      const signed = await partiallySignTransaction(
        [keyPair],
        getTransactionDecoder().decode(transaction),
      );
      return new Uint8Array(getTransactionEncoder().encode(signed));
    },
  };
}

/**
 * Runs inside the page. It registers a Wallet Standard wallet the same way a real one does, and
 * every signature it produces comes back from the harness, never from anything in the browser.
 */
export function installTestWallet(seed: {
  address: string;
  publicKeyBytes: number[];
  name: string;
}): void {
  const account = {
    address: seed.address,
    publicKey: Uint8Array.from(seed.publicKeyBytes),
    chains: ['solana:devnet'],
    features: ['solana:signMessage', 'solana:signTransaction'],
  };

  const bridge = window as unknown as {
    __accrueE2eSignMessage(message: number[]): Promise<number[]>;
    __accrueE2eSignTransaction(transaction: number[]): Promise<number[]>;
  };

  const wallet = {
    version: '1.0.0',
    name: seed.name,
    icon: 'data:image/svg+xml;base64,',
    chains: ['solana:devnet'],
    accounts: [account],
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: () => Promise.resolve({ accounts: [account] }),
      },
      'standard:events': {
        version: '1.0.0',
        on: () => () => undefined,
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (input: { message: Uint8Array }) => {
          const signature = await bridge.__accrueE2eSignMessage([...input.message]);
          return [
            { signedMessage: input.message, signature: Uint8Array.from(signature) },
          ];
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        signTransaction: async (input: { transaction: Uint8Array }) => {
          const signed = await bridge.__accrueE2eSignTransaction([...input.transaction]);
          return [{ signedTransaction: Uint8Array.from(signed) }];
        },
      },
    },
  };

  const announce = (event: Event): void => {
    const detail = (event as CustomEvent<{ register(...wallets: unknown[]): void }>)
      .detail;
    detail.register(wallet);
  };

  window.addEventListener('wallet-standard:app-ready', announce);
  window.dispatchEvent(
    new CustomEvent('wallet-standard:register-wallet', {
      detail: (api: { register(...wallets: unknown[]): void }) => {
        api.register(wallet);
      },
    }),
  );
}
