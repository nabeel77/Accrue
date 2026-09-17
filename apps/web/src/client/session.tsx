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
  connectFirstWallet,
  signMessage,
  signTransaction,
  type StandardWallet,
} from './wallet.js';

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

interface SessionValue {
  readonly me: Me | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly signIn: () => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly acceptTerms: () => Promise<void>;
  readonly acknowledgeRisks: () => Promise<void>;
  readonly signAndSubmit: (
    base64Transactions: readonly string[],
    buildId?: string,
  ) => Promise<string>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<{
    wallet: StandardWallet;
    account: StandardWallet['accounts'][number];
  } | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const answer = await fetch('/api/me');
    setMe((await answer.json()) as Me);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const opened = connected ?? (await connectFirstWallet());
      if (opened === null) {
        setError('No wallet is available in this browser.');
        return;
      }
      setConnected(opened);

      const asked = await fetch(
        `/api/auth/nonce?wallet=${encodeURIComponent(opened.account.address)}`,
      );
      const challenge = (await asked.json()) as {
        nonce: string;
        issuedAt: string;
        message: string;
      };
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
        setError('That sign in did not go through.');
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [connected, refresh]);

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

  const signAndSubmit = useCallback(
    async (base64Transactions: readonly string[], buildId?: string): Promise<string> => {
      const opened = connected ?? (await connectFirstWallet());
      if (opened === null) {
        throw new Error('no wallet');
      }
      const { fromBase64, toBase64 } = await import('./encoding.js');
      const signedTransactions: string[] = [];
      for (const base64Transaction of base64Transactions) {
        const signed = await signTransaction(
          opened.wallet,
          opened.account,
          fromBase64(base64Transaction),
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
      const answer = (await sent.json()) as { signature?: string; error?: string };
      if (answer.signature === undefined) {
        throw new Error(answer.error ?? 'that transaction did not go through');
      }
      return answer.signature;
    },
    [connected],
  );

  const value = useMemo<SessionValue>(
    () => ({
      me,
      busy,
      error,
      refresh,
      signIn,
      signOut,
      acceptTerms,
      acknowledgeRisks,
      signAndSubmit,
    }),
    [
      me,
      busy,
      error,
      refresh,
      signIn,
      signOut,
      acceptTerms,
      acknowledgeRisks,
      signAndSubmit,
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
