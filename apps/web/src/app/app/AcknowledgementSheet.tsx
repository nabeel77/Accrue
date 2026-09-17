'use client';

import { useState, type JSX } from 'react';

import { Button, Muted, Sheet, Stack } from '../../components/ui/index.js';
import { useSession } from '../../client/session.js';

/**
 * The sentences come from the module, never from this file, and every one of them is on screen
 * before the single button. There is no checkbox.
 */
export function AcknowledgementSheet({
  open,
  onAccepted,
}: {
  open: boolean;
  onAccepted: () => void;
}): JSX.Element | null {
  const { me, acknowledgeRisks } = useSession();
  const [busy, setBusy] = useState(false);
  const acknowledgement = me?.acknowledgement;

  if (acknowledgement === undefined) {
    return null;
  }

  return (
    <Sheet title={acknowledgement.title} open={open} testId="acknowledgement">
      <Stack gap={14}>
        {acknowledgement.sentences.map((sentence) => (
          <p
            key={sentence.slice(0, 40)}
            style={{ margin: 0, color: 'var(--color-text)' }}
          >
            {sentence}
          </p>
        ))}
        <Button
          testId="acknowledge"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void acknowledgeRisks()
              .then(onAccepted)
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {acknowledgement.button}
        </Button>
        <Muted>{acknowledgement.footnote}</Muted>
      </Stack>
    </Sheet>
  );
}
