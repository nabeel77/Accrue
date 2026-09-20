'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useState, type JSX, type ReactNode } from 'react';

import { AccrueMark } from '../../components/AccrueMark.js';
import { Banner, Button, WalletPill } from '../../components/ui/index.js';
import { COMMON, DEVNET, NAV } from '../../copy/common.js';
import { FAILURE_COPY, FAILURE_DETAILS } from '../../copy/errors.js';
import { useSession } from '../../client/session.js';
import { TermsGate } from './TermsGate.js';
import { WalletSheet } from './WalletSheet.js';

const LINKS = [
  { href: '/app', label: NAV.deposit },
  { href: '/app/portfolio', label: NAV.portfolio },
  { href: '/app/activity', label: NAV.activity },
] as const;

export function AppShell({
  children,
  isDevnet,
}: {
  children: ReactNode;
  isDevnet: boolean;
}): JSX.Element {
  const { me, signOut, busy, failure, onTheWrongNetwork, networkName } = useSession();
  const path = usePathname();
  const [faucet, setFaucet] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [pickingWallet, setPickingWallet] = useState(false);
  const [whatTheFaucetSent, setWhatTheFaucetSent] = useState('');

  const askTheFaucet = useCallback(async (): Promise<void> => {
    setFaucet('sending');
    const answer = await fetch('/api/devnet/faucet', { method: 'POST' });
    if (!answer.ok) {
      setFaucet('failed');
      return;
    }
    const granted = (await answer.json()) as {
      grants?: { symbol: string; amount: string }[];
      solSent?: string | null;
    };
    const named = (granted.grants ?? []).map(
      (grant) => `${grant.amount} ${grant.symbol}`,
    );
    if (granted.solSent != null) {
      named.push(DEVNET.andSomeSol(granted.solSent));
    }
    setWhatTheFaucetSent(named.join(', '));
    setFaucet('sent');
  }, []);

  const faucetLine =
    faucet === 'sending'
      ? DEVNET.gettingTestTokens
      : faucet === 'sent'
        ? whatTheFaucetSent === ''
          ? DEVNET.testTokensSentNothingNamed
          : DEVNET.testTokensSent(whatTheFaucetSent)
        : faucet === 'failed'
          ? DEVNET.testTokensFailed
          : DEVNET.getTestTokens;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background: 'var(--color-ground)',
      }}
    >
      {isDevnet ? (
        <div data-testid="devnet-banner" style={{ padding: '8px 24px' }}>
          <Banner tone="notice">
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span>{DEVNET.banner}</span>
              {me?.signedIn === true ? (
                <Button
                  tone="quiet"
                  testId="faucet"
                  disabled={faucet === 'sending'}
                  onClick={() => void askTheFaucet()}
                >
                  {faucetLine}
                </Button>
              ) : null}
            </span>
          </Banner>
        </div>
      ) : null}

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '16px 24px',
          borderBottom: '1px solid var(--color-hairline)',
          flexWrap: 'wrap',
        }}
      >
        <Link
          href="/app"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            textDecoration: 'none',
          }}
        >
          <AccrueMark size={20} />
          <span
            style={{
              color: 'var(--color-text)',
              fontWeight: 500,
              letterSpacing: '-0.02em',
            }}
          >
            accrue
          </span>
        </Link>

        <nav style={{ display: 'flex', gap: 18 }}>
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              data-testid={`nav-${link.label.toLowerCase()}`}
              style={{
                textDecoration: 'none',
                color:
                  path === link.href
                    ? 'var(--color-text)'
                    : 'var(--color-text-secondary)',
              }}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/app/about"
            data-testid="nav-about"
            style={{ textDecoration: 'none', color: 'var(--color-text-secondary)' }}
          >
            {NAV.about}
          </Link>
        </nav>

        {me?.signedIn === true && me.wallet !== undefined ? (
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <WalletPill address={me.wallet} />
            <Button tone="link" onClick={() => void signOut()}>
              {COMMON.signOut}
            </Button>
          </span>
        ) : (
          <Button
            testId="sign-in"
            onClick={() => {
              setPickingWallet(true);
            }}
            disabled={busy}
          >
            {busy ? COMMON.signingIn : COMMON.connectWallet}
          </Button>
        )}
      </header>

      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          width: '100%',
          maxWidth: 1440,
          margin: '0 auto',
          padding: '24px',
        }}
      >
        {onTheWrongNetwork ? (
          <div style={{ paddingBottom: 16 }}>
            <Banner tone="caution" testId="wrong-network">
              {`${FAILURE_COPY.wrongNetwork} ${FAILURE_DETAILS.switchTo(networkName)}`}
            </Banner>
          </div>
        ) : null}
        {failure === null ? null : (
          <div style={{ paddingBottom: 16 }}>
            <Banner tone="caution" testId="session-failure">
              {failure.sentence}
            </Banner>
          </div>
        )}
        <TermsGate
          onConnect={() => {
            setPickingWallet(true);
          }}
        >
          {children}
        </TermsGate>
      </main>

      <WalletSheet
        open={pickingWallet}
        onClose={() => {
          setPickingWallet(false);
        }}
      />
    </div>
  );
}
