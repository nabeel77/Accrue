'use client';

import type { JSX, ReactNode } from 'react';

import { Button, Heading, Muted, Panel, Stack } from '../../components/ui/index.js';
import { ACKNOWLEDGEMENT_COPY } from '../../copy/acknowledgement.js';
import { COMMON } from '../../copy/common.js';
import { TERMS_COPY } from '../../copy/terms.js';
import { useSession } from '../../client/session.js';

/**
 * Nobody enters the app without the terms. The acknowledgement is a sheet with the sentences
 * visible and one button, never a checkbox, and it is asked for before the first position rather
 * than here.
 */
export function TermsGate({ children }: { children: ReactNode }): JSX.Element {
  const { me, signIn, acceptTerms, busy } = useSession();

  if (me === null) {
    return <Muted>{COMMON.loading}</Muted>;
  }

  if (!me.signedIn) {
    return (
      <Panel style={{ maxWidth: 560 }}>
        <Stack gap={14}>
          <Heading level={1}>accrue</Heading>
          <Muted>{COMMON.signMessagePrompt}</Muted>
          <div>
            <Button testId="gate-sign-in" onClick={() => void signIn()} disabled={busy}>
              {busy ? COMMON.signingIn : COMMON.connectWallet}
            </Button>
          </div>
        </Stack>
      </Panel>
    );
  }

  if (me.terms.accepted !== true) {
    return (
      <Panel style={{ maxWidth: 640 }} testId="terms-gate">
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
          <Muted>{ACKNOWLEDGEMENT_COPY.footnote}</Muted>
        </Stack>
      </Panel>
    );
  }

  return <>{children}</>;
}
