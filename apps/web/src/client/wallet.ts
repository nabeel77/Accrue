'use client';

/**
 * Wallet Standard, not the old adapter. We read the wallets the page advertises and use the two
 * features we need: connect and sign a message. Nothing here signs anything we did not build.
 */
export interface StandardWallet {
  readonly name: string;
  readonly icon?: string;
  readonly accounts: readonly {
    readonly address: string;
    readonly publicKey: Uint8Array;
  }[];
  readonly features: Record<string, unknown>;
}

interface ConnectFeature {
  connect(): Promise<{ accounts: readonly StandardWallet['accounts'][number][] }>;
}

interface SignMessageFeature {
  signMessage(input: {
    account: StandardWallet['accounts'][number];
    message: Uint8Array;
  }): Promise<readonly { signature: Uint8Array }[]>;
}

interface SignTransactionFeature {
  signTransaction(input: {
    account: StandardWallet['accounts'][number];
    transaction: Uint8Array;
  }): Promise<readonly { signedTransaction: Uint8Array }[]>;
}

interface RegisterApi {
  register(...wallets: readonly StandardWallet[]): () => void;
}

const registered: StandardWallet[] = [];
let listening = false;

/**
 * The Wallet Standard handshake: wallets that loaded first answer the ready event, wallets that
 * load later announce themselves. No hardcoded list of wallets anywhere.
 */
function listenForWallets(): void {
  if (listening || typeof window === 'undefined') {
    return;
  }
  listening = true;
  const api: RegisterApi = {
    register(...wallets) {
      for (const wallet of wallets) {
        if (!registered.includes(wallet)) {
          registered.push(wallet);
        }
      }
      return () => undefined;
    },
  };
  window.addEventListener('wallet-standard:register-wallet', (event) => {
    (event as CustomEvent<(given: RegisterApi) => void>).detail(api);
  });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
}

export function availableWallets(): readonly StandardWallet[] {
  listenForWallets();
  return registered;
}

export async function connectFirstWallet(): Promise<{
  wallet: StandardWallet;
  account: StandardWallet['accounts'][number];
} | null> {
  const [wallet] = availableWallets();
  if (wallet === undefined) {
    return null;
  }
  const connect = wallet.features['standard:connect'] as ConnectFeature | undefined;
  if (connect === undefined) {
    return null;
  }
  const { accounts } = await connect.connect();
  const account = accounts[0] ?? wallet.accounts[0];
  return account === undefined ? null : { wallet, account };
}

export async function signMessage(
  wallet: StandardWallet,
  account: StandardWallet['accounts'][number],
  message: string,
): Promise<Uint8Array> {
  const feature = wallet.features['solana:signMessage'] as SignMessageFeature | undefined;
  if (feature === undefined) {
    throw new Error('that wallet cannot sign a message');
  }
  const [signed] = await feature.signMessage({
    account,
    message: new TextEncoder().encode(message),
  });
  if (signed === undefined) {
    throw new Error('that wallet returned no signature');
  }
  return signed.signature;
}

export async function signTransaction(
  wallet: StandardWallet,
  account: StandardWallet['accounts'][number],
  transaction: Uint8Array,
): Promise<Uint8Array> {
  const feature = wallet.features['solana:signTransaction'] as
    SignTransactionFeature | undefined;
  if (feature === undefined) {
    throw new Error('that wallet cannot sign a transaction');
  }
  const [signed] = await feature.signTransaction({ account, transaction });
  if (signed === undefined) {
    throw new Error('that wallet returned no signed transaction');
  }
  return signed.signedTransaction;
}
