'use client';

// Wallet Standard, not the old adapter.
export interface StandardAccount {
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly chains?: readonly string[];
}

export interface StandardWallet {
  readonly name: string;
  readonly icon?: string;
  readonly chains?: readonly string[];
  readonly accounts: readonly StandardAccount[];
  readonly features: Record<string, unknown>;
}

interface ConnectFeature {
  connect(): Promise<{ accounts: readonly StandardAccount[] }>;
}

interface EventsFeature {
  on(
    event: 'change',
    handler: (changed: { accounts?: readonly StandardAccount[] }) => void,
  ): () => void;
}

interface SignMessageFeature {
  signMessage(input: {
    account: StandardAccount;
    message: Uint8Array;
  }): Promise<readonly { signature: Uint8Array }[]>;
}

interface SignTransactionFeature {
  signTransaction(input: {
    account: StandardAccount;
    transaction: Uint8Array;
    chain?: string;
  }): Promise<readonly { signedTransaction: Uint8Array }[]>;
  // Wallet Standard says which transaction versions a wallet can read. One that predates
  // version one does not list it, and handing it one anyway fails inside the wallet.
  readonly supportedTransactionVersions?: readonly (string | number)[];
}

interface SignAndSendTransactionFeature {
  signAndSendTransaction(input: {
    account: StandardAccount;
    transaction: Uint8Array;
    chain: string;
  }): Promise<readonly { signature: Uint8Array }[]>;
  readonly supportedTransactionVersions?: readonly (string | number)[];
}

interface RegisterApi {
  register(...wallets: readonly StandardWallet[]): () => void;
}

const registered: StandardWallet[] = [];
let listening = false;

export function chainForCluster(cluster: 'devnet' | 'mainnet'): string {
  return cluster === 'devnet' ? 'solana:devnet' : 'solana:mainnet';
}

// The Wallet Standard handshake: wallets already loaded answer the ready event, later ones announce.
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

// Only a wallet that says it speaks this chain is offered, and only its accounts that say so too.
export function walletsForTheChain(chain: string): readonly StandardWallet[] {
  return availableWallets().filter(
    (wallet) => wallet.chains === undefined || wallet.chains.includes(chain),
  );
}

export function accountsForTheChain(
  wallet: StandardWallet,
  chain: string,
): readonly StandardAccount[] {
  return wallet.accounts.filter(
    (account) => account.chains === undefined || account.chains.includes(chain),
  );
}

function theSigningFeature(wallet: StandardWallet): SignTransactionFeature | undefined {
  return wallet.features['solana:signTransaction'] as SignTransactionFeature | undefined;
}

function theSendingFeature(
  wallet: StandardWallet,
): SignAndSendTransactionFeature | undefined {
  return wallet.features['solana:signAndSendTransaction'] as
    SignAndSendTransactionFeature | undefined;
}

export function canSignTransaction(wallet: StandardWallet): boolean {
  return theSigningFeature(wallet) !== undefined;
}

export function canSignAndSendTransaction(wallet: StandardWallet): boolean {
  return theSendingFeature(wallet) !== undefined;
}

export function takesVersionOne(wallet: StandardWallet): boolean {
  const versions =
    theSigningFeature(wallet)?.supportedTransactionVersions ??
    theSendingFeature(wallet)?.supportedTransactionVersions;
  return Array.isArray(versions) && versions.some((one) => one === 1 || one === '1');
}

export async function connectTheWallet(
  wallet: StandardWallet,
  chain: string,
): Promise<{ wallet: StandardWallet; account: StandardAccount } | null> {
  const connect = wallet.features['standard:connect'] as ConnectFeature | undefined;
  if (connect === undefined) {
    return null;
  }
  const { accounts } = await connect.connect();
  const offered = accounts.filter(
    (account) => account.chains === undefined || account.chains.includes(chain),
  );
  const account = offered[0] ?? accountsForTheChain(wallet, chain)[0];
  return account === undefined ? null : { wallet, account };
}

export function whenTheWalletChanges(
  wallet: StandardWallet,
  changed: (account: StandardAccount | null) => void,
): () => void {
  const feature = wallet.features['standard:events'] as EventsFeature | undefined;
  if (feature === undefined) {
    return () => undefined;
  }
  return feature.on('change', (what) => {
    if (what.accounts === undefined) {
      return;
    }
    changed(what.accounts[0] ?? null);
  });
}

export async function signMessage(
  wallet: StandardWallet,
  account: StandardAccount,
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
  account: StandardAccount,
  transaction: Uint8Array,
  chain: string,
): Promise<Uint8Array> {
  const feature = wallet.features['solana:signTransaction'] as
    SignTransactionFeature | undefined;
  if (feature === undefined) {
    throw new Error('that wallet cannot sign a transaction');
  }
  const [signed] = await feature.signTransaction({ account, transaction, chain });
  if (signed === undefined) {
    throw new Error('that wallet returned no signed transaction');
  }
  return signed.signedTransaction;
}

const REMEMBERED = 'accrue.wallet';

export function rememberTheChoice(name: string): void {
  try {
    window.localStorage.setItem(REMEMBERED, name);
  } catch {
    return;
  }
}

export function theRememberedChoice(): string | null {
  try {
    return window.localStorage.getItem(REMEMBERED);
  } catch {
    return null;
  }
}

export async function signAndSendTransaction(
  wallet: StandardWallet,
  account: StandardAccount,
  transaction: Uint8Array,
  chain: string,
): Promise<Uint8Array> {
  const feature = theSendingFeature(wallet);
  if (feature === undefined) {
    throw new Error('that wallet cannot send a transaction');
  }
  const [sent] = await feature.signAndSendTransaction({ account, transaction, chain });
  if (sent === undefined) {
    throw new Error('that wallet returned no signature');
  }
  return sent.signature;
}
