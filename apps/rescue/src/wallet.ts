export interface StandardAccount {
  readonly address: string;
  readonly publicKey: Uint8Array;
}

export interface StandardWallet {
  readonly name: string;
  readonly accounts: readonly StandardAccount[];
  readonly features: Record<string, unknown>;
}

interface ConnectFeature {
  connect(): Promise<{ accounts: readonly StandardAccount[] }>;
}

interface SignTransactionFeature {
  signTransaction(input: {
    account: StandardAccount;
    transaction: Uint8Array;
  }): Promise<readonly { signedTransaction: Uint8Array }[]>;
}

interface RegisterApi {
  register(...wallets: readonly StandardWallet[]): () => void;
}

const registered: StandardWallet[] = [];
let listening = false;

function listenForWallets(): void {
  if (listening) {
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
  account: StandardAccount;
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

export async function signTransaction(
  wallet: StandardWallet,
  account: StandardAccount,
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
