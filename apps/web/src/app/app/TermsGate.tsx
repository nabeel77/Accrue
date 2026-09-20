'use client';

import type { JSX, ReactNode } from 'react';

import {
  Button,
  CENTRED_SCREEN,
  Heading,
  Muted,
  Panel,
  SkeletonRows,
  Stack,
} from '../../components/ui/index.js';
import { COMMON } from '../../copy/common.js';
import { TERMS_COPY } from '../../copy/terms.js';
import { useSession } from '../../client/session.js';

// Nobody enters the app without the terms.
export function TermsGate({
  children,
  onConnect,
}: {
  children: ReactNode;
  onConnect: () => void;
}): JSX.Element {
  const { me, acceptTerms, busy } = useSession();

  if (me === null) {
    return (
      <Panel style={{ ...CENTRED_SCREEN, maxWidth: 560 }}>
        <SkeletonRows rows={3} testId="terms-loading" />
      </Panel>
    );
  }

  if (!me.signedIn) {
    return (
      <Panel style={{ ...CENTRED_SCREEN, maxWidth: 560 }}>
        <Stack gap={14}>
          <Heading level={1}>accrue</Heading>
          <Muted>{COMMON.signMessagePrompt}</Muted>
          <div>
            <Button testId="gate-sign-in" onClick={onConnect} disabled={busy}>
              {busy ? COMMON.signingIn : COMMON.connectWallet}
            </Button>
          </div>
        </Stack>
      </Panel>
    );
  }

  if (me.terms.accepted !== true) {
    return (
      <Panel style={{ ...CENTRED_SCREEN, maxWidth: 640 }} testId="terms-gate">
        <Stack gap={14}>
          <Heading level={1}>{TERMS_COPY.title}</Heading>
          <Muted>{TERMS_COPY.intro}</Muted>
          <Stack gap={10}>
            {me.terms.summary.map((line) => (
              <p key={line} style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
                {line}
              </p>
            ))}
          </Stack>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button testId="accept-terms" onClick={() => void acceptTerms()}>
              {TERMS_COPY.accept}
            </Button>
            <Button
              tone="link"
              onClick={() => {
                window.location.href = '/';
              }}
            >
              {TERMS_COPY.decline}
            </Button>
          </div>
        </Stack>
      </Panel>
    );
  }

  return <>{children}</>;
}
