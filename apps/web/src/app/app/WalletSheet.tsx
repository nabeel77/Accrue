'use client';

import { useState, type JSX } from 'react';

import { Banner, Button, Muted, Sheet, Stack } from '../../components/ui/index.js';
import { COMMON, WALLETS } from '../../copy/common.js';
import { FAILURE_COPY, FAILURE_DETAILS } from '../../copy/errors.js';
import { useSession } from '../../client/session.js';

export function WalletSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const { walletChoices, signIn, failure, onTheWrongNetwork, networkName } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const choices = open ? walletChoices() : [];
  const nothingToOffer = onTheWrongNetwork
    ? `${FAILURE_COPY.wrongNetwork} ${FAILURE_DETAILS.switchTo(networkName)}`
    : WALLETS.none;

  return (
    <Sheet title={WALLETS.title} open={open} testId="wallet-sheet" onClose={onClose}>
      <Stack gap={12}>
        {failure === null ? null : (
          <Banner tone="caution" testId="wallet-failure">
            {failure.sentence}
          </Banner>
        )}
        {choices.length === 0 ? (
          <Stack gap={8}>
            <Muted testId="no-wallet-for-this-network">{nothingToOffer}</Muted>
            <Muted>{WALLETS.onAPhone}</Muted>
          </Stack>
        ) : null}
        {choices.map((choice) => (
          <Button
            key={choice.name}
            tone="quiet"
            testId={`wallet-${choice.name}`}
            disabled={busy !== null}
            onClick={() => {
              setBusy(choice.name);
              void signIn(choice.name)
                .then(onClose)
                .finally(() => {
                  setBusy(null);
                });
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {choice.icon === undefined ? null : (
                <img src={choice.icon} alt="" width={20} height={20} />
              )}
              <span>{busy === choice.name ? WALLETS.connecting : choice.name}</span>
            </span>
          </Button>
        ))}
        {busy === null ? null : <Muted testId="wallet-signing">{WALLETS.signing}</Muted>}
        <Button tone="link" onClick={onClose}>
          {COMMON.cancel}
        </Button>
      </Stack>
    </Sheet>
  );
}
