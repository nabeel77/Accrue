'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { toBase58 } from './encoding.js';
import {
  failureOf,
  readFailure,
  readTheAnswer,
  SubmissionRefused,
  theWalletSaidNo,
  type ReadableFailure,
} from './failures.js';
import {
  availableWallets,
  chainForCluster,
  connectTheWallet,
  rememberTheChoice,
  signMessage,
  canSignAndSendTransaction,
  canSignTransaction,
  signAndSendTransaction,
  signTransaction,
  takesVersionOne,
  theRememberedChoice,
  walletsForTheChain,
  type StandardAccount,
  type StandardWallet,
} from './wallet.js';
import { offerTheMobileWallet } from './mobileWallet.js';
import { WALLET_TAKES_VERSION_ONE_HEADER } from '../walletVersions.js';

export interface Me {
  readonly signedIn: boolean;
  readonly wallet?: string;
  readonly cluster: 'devnet' | 'mainnet';
  readonly terms: {
    version: number;
    accepted?: boolean;
    title: string;
    summary: readonly string[];
  };
  readonly acknowledgement?: {
    version: number;
    accepted: boolean;
    title: string;
    sentences: readonly string[];
    button: string;
    footnote: string;
  };
}

export interface WalletChoice {
  readonly name: string;
  readonly icon: string | undefined;
}

interface SessionValue {
  readonly me: Me | null;
  readonly busy: boolean;
  readonly failure: ReadableFailure | null;
  // True when the wallet is connected to a network this deployment does not run on.
  readonly onTheWrongNetwork: boolean;
  readonly networkName: 'devnet' | 'mainnet';
  readonly refresh: () => Promise<void>;
  readonly signIn: (walletName?: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly acceptTerms: () => Promise<void>;
  readonly acknowledgeRisks: () => Promise<void>;
  readonly signAndSubmit: (
    base64Transactions: readonly string[],
    buildId?: string,
  ) => Promise<string>;
  // What every build request must carry, so the server compiles a transaction this wallet can
  // actually read.
  readonly headersForABuild: () => Record<string, string>;
  readonly walletChoices: () => readonly WalletChoice[];
  readonly chooseWallet: (name: string) => Promise<void>;
  readonly connectedWallet: string | null;
}

const A_MOMENT = 500;
const LONG_ENOUGH_FOR_WALLETS = 5_000;

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReadableFailure | null>(null);
  const [connected, setConnected] = useState<{
    wallet: StandardWallet;
    account: StandardAccount;
  } | null>(null);

  const [walletsOnTheBrowser, setWalletsOnTheBrowser] = useState({
    any: false,
    onOurChain: false,
  });

  const networkName = me?.cluster ?? 'mainnet';
  const chain = chainForCluster(networkName);

  // Wallets announce themselves over the first moments of a page, so the survey is taken again.
  useEffect(() => {
    offerTheMobileWallet(chain);
    const look = (): void => {
      setWalletsOnTheBrowser({
        any: availableWallets().length > 0,
        onOurChain: walletsForTheChain(chain).length > 0,
      });
    };
    look();
    const again = setInterval(look, A_MOMENT);
    const enough = setTimeout(() => {
      clearInterval(again);
    }, LONG_ENOUGH_FOR_WALLETS);
    return () => {
      clearInterval(again);
      clearTimeout(enough);
    };
  }, [chain]);

  // A wallet that leaves our chain out of the ones it speaks is pointed at another network.
  const walletChains = connected?.account.chains;
  const onTheWrongNetwork =
    (walletsOnTheBrowser.any && !walletsOnTheBrowser.onOurChain) ||
    (walletChains !== undefined && !walletChains.includes(chain));

  const walletChoices = useCallback(
    (): readonly WalletChoice[] =>
      walletsForTheChain(chain).map((wallet) => ({
        name: wallet.name,
        icon: wallet.icon,
      })),
    [chain],
  );

  const openTheWallet = useCallback(
    async (name: string | null) => {
      const wallets = walletsForTheChain(chain);
      const wanted =
        wallets.find((one) => one.name === name) ??
        wallets.find((one) => one.name === theRememberedChoice()) ??
        wallets[0];
      if (wanted === undefined) {
        return null;
      }
      const opened = await connectTheWallet(wanted, chain);
      if (opened !== null) {
        rememberTheChoice(opened.wallet.name);
        setConnected(opened);
      }
      return opened;
    },
    [chain],
  );

  const chooseWallet = useCallback(
    async (name: string): Promise<void> => {
      await openTheWallet(name);
    },
    [openTheWallet],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const answer = await fetch('/api/me');
    setMe((await answer.json()) as Me);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (walletName?: string): Promise<void> => {
      setBusy(true);
      setFailure(null);
      try {
        const opened =
          walletName === undefined
            ? (connected ?? (await openTheWallet(null)))
            : await openTheWallet(walletName);
        if (opened === null) {
          setFailure(failureOf('noWallet'));
          return;
        }
        setConnected(opened);

        const asked = await fetch(
          `/api/auth/nonce?wallet=${encodeURIComponent(opened.account.address)}`,
        );
        const challenge = await readTheAnswer<{
          nonce?: string;
          issuedAt?: string;
          message?: string;
        }>(asked);
        if (
          challenge.message === undefined ||
          challenge.nonce === undefined ||
          challenge.issuedAt === undefined
        ) {
          setFailure(readFailure(challenge) ?? failureOf('signInFailed'));
          return;
        }
        const signature = await signMessage(
          opened.wallet,
          opened.account,
          challenge.message,
        );
        const verified = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            wallet: opened.account.address,
            nonce: challenge.nonce,
            issuedAt: challenge.issuedAt,
            signature: toBase58(signature),
          }),
        });
        if (!verified.ok) {
          setFailure(
            readFailure(await readTheAnswer(verified)) ?? failureOf('signInFailed'),
          );
          return;
        }
        await refresh();
      } catch (thrown) {
        setFailure(
          theWalletSaidNo(thrown)
            ? failureOf('signatureRejected', thrown)
            : failureOf('signInFailed', thrown),
        );
      } finally {
        setBusy(false);
      }
    },
    [connected, refresh, openTheWallet],
  );

  const signOut = useCallback(async (): Promise<void> => {
    await fetch('/api/auth/signout', { method: 'POST' });
    await refresh();
  }, [refresh]);

  const acceptTerms = useCallback(async (): Promise<void> => {
    if (me === null) {
      return;
    }
    await fetch('/api/me/accept-terms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: me.terms.version }),
    });
    await refresh();
  }, [me, refresh]);

  const acknowledgeRisks = useCallback(async (): Promise<void> => {
    if (me?.acknowledgement === undefined) {
      return;
    }
    await fetch('/api/me/acknowledge-risks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: me.acknowledgement.version }),
    });
    await refresh();
  }, [me, refresh]);

  const headersForABuild = useCallback(
    (): Record<string, string> => ({
      'content-type': 'application/json',
      [WALLET_TAKES_VERSION_ONE_HEADER]:
        connected !== null && takesVersionOne(connected.wallet) ? 'true' : 'false',
    }),
    [connected],
  );

  const signAndSubmit = useCallback(
    async (base64Transactions: readonly string[], buildId?: string): Promise<string> => {
      const opened = connected ?? (await openTheWallet(null));
      if (opened === null) {
        throw new SubmissionRefused(failureOf('noWallet'));
      }
      const { fromBase64, toBase64 } = await import('./encoding.js');

      if (!canSignTransaction(opened.wallet)) {
        if (!canSignAndSendTransaction(opened.wallet)) {
          throw new SubmissionRefused(failureOf('walletCannotSign'));
        }
        const sentSignatures: string[] = [];
        for (const base64Transaction of base64Transactions) {
          sentSignatures.push(
            toBase58(
              await signAndSendTransaction(
                opened.wallet,
                opened.account,
                fromBase64(base64Transaction),
                chain,
              ),
            ),
          );
        }
        const first = sentSignatures[0];
        if (first === undefined) {
          throw new SubmissionRefused(failureOf('somethingWentWrong'));
        }
        if (buildId !== undefined) {
          await fetch('/api/positions/submit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ buildId, signatures: sentSignatures }),
          });
        }
        return first;
      }

      const signedTransactions: string[] = [];
      for (const base64Transaction of base64Transactions) {
        const signed = await signTransaction(
          opened.wallet,
          opened.account,
          fromBase64(base64Transaction),
          chain,
        );
        signedTransactions.push(toBase64(signed));
      }
      const sent = await fetch('/api/positions/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          buildId === undefined
            ? { signedTransactions }
            : { buildId, signedTransactions },
        ),
      });
      const answer = await readTheAnswer<{ signature?: string }>(sent);
      if (answer.signature === undefined) {
        throw new SubmissionRefused(
          readFailure(answer) ?? failureOf('somethingWentWrong'),
        );
      }
      return answer.signature;
    },
    [connected, openTheWallet, chain],
  );

  const value = useMemo<SessionValue>(
    () => ({
      me,
      busy,
      failure,
      onTheWrongNetwork,
      networkName,
      refresh,
      signIn,
      signOut,
      acceptTerms,
      acknowledgeRisks,
      signAndSubmit,
      headersForABuild,
      walletChoices,
      chooseWallet,
      connectedWallet: connected?.wallet.name ?? null,
    }),
    [
      me,
      busy,
      failure,
      onTheWrongNetwork,
      networkName,
      refresh,
      signIn,
      signOut,
      acceptTerms,
      acknowledgeRisks,
      signAndSubmit,
      headersForABuild,
      walletChoices,
      chooseWallet,
      connected,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession outside the provider');
  }
  return value;
}
