import type { JSX } from 'react';

import {
  CENTRED_SCREEN,
  Heading,
  Muted,
  NumbersInMono,
  Panel,
  Secondary,
  Stack,
} from '../../../components/ui/index.js';
import { ABOUT_COPY } from '../../../copy/about.js';

export default function AboutPage(): JSX.Element {
  return (
    <Stack gap={24} style={{ ...CENTRED_SCREEN, maxWidth: 760 }} testId="about-screen">
      <Heading level={1}>{ABOUT_COPY.title}</Heading>

      <Panel>
        <Stack gap={16}>
          <Heading level={2}>{ABOUT_COPY.howItWorksTitle}</Heading>
          {ABOUT_COPY.howItWorks.map((step) => (
            <Stack key={step.heading} gap={6}>
              <strong style={{ color: 'var(--color-text)', fontWeight: 500 }}>
                {step.heading}
              </strong>
              <Secondary>{step.body}</Secondary>
              <Muted>
                <NumbersInMono sentence={step.example} />
              </Muted>
            </Stack>
          ))}
        </Stack>
      </Panel>

      <Panel>
        <Stack gap={14}>
          <Heading level={2}>{ABOUT_COPY.whatCanGoWrongTitle}</Heading>
          {ABOUT_COPY.whatCanGoWrong.map((risk) => (
            <Stack key={risk.body.slice(0, 40)} gap={6}>
              <Secondary>{risk.body}</Secondary>
              {risk.example === null ? null : (
                <Muted>
                  <NumbersInMono sentence={risk.example} />
                </Muted>
              )}
            </Stack>
          ))}
        </Stack>
      </Panel>
    </Stack>
  );
}
