'use client';

import { useEffect, useState, type JSX } from 'react';

import {
  CENTRED_SCREEN,
  Heading,
  Mono,
  Muted,
  NumbersInMono,
  Panel,
  Row,
  Secondary,
  Stack,
} from '../../../components/ui/index.js';
import { ABOUT_COPY } from '../../../copy/about.js';
import { COMMON } from '../../../copy/common.js';

interface ProgramLine {
  readonly programId: string | null;
  readonly build: string | null;
  readonly upgradeAuthority: string | null;
}

export default function AboutPage(): JSX.Element {
  const [program, setProgram] = useState<ProgramLine | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      const answer = await fetch('/api/program');
      if (answer.ok) {
        setProgram((await answer.json()) as ProgramLine);
      }
    })();
  }, []);

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

      <Stack gap={4} testId="program-line">
        <Row style={{ justifyContent: 'flex-start', gap: 10 }}>
          <Muted>{ABOUT_COPY.programLineLabels.program}</Muted>
          <Mono tone="muted" style={{ fontSize: 12 }}>
            {program?.programId ?? COMMON.missingValue}
          </Mono>
          <Muted>{ABOUT_COPY.programLineLabels.build}</Muted>
          <Mono tone="muted" style={{ fontSize: 12 }}>
            {program?.build ?? COMMON.missingValue}
          </Mono>
          <Muted>{ABOUT_COPY.programLineLabels.upgradeAuthority}</Muted>
          <Mono tone="muted" style={{ fontSize: 12 }}>
            {program?.upgradeAuthority ?? COMMON.missingValue}
          </Mono>
        </Row>
      </Stack>
    </Stack>
  );
}
