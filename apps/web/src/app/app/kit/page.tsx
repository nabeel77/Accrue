import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { AccrueMark, AccrueWordmark } from '@/components/AccrueMark';

import { DESIGN_TOKEN_GROUPS } from './designTokens';

const COLOUR_TOKEN_PREFIX = '--color-';

function TokenSwatch({ name, value }: { name: string; value: string }): JSX.Element {
  const isColour = name.startsWith(COLOUR_TOKEN_PREFIX);
  return (
    <div
      style={{
        border: '1px solid var(--color-hairline)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {isColour ? (
        <div style={{ height: 72, background: `var(${name})` }} />
      ) : (
        <div
          style={{
            height: 72,
            display: 'flex',
            alignItems: 'center',
            padding: '0 14px',
            background: 'var(--color-raised)',
            fontFamily: `var(${name})`,
            fontSize: 18,
          }}
        >
          Aa 0123
        </div>
      )}
      <div style={{ padding: '10px 14px', display: 'grid', gap: 3 }}>
        <span className="mono" style={{ fontSize: 12 }}>
          {name}
        </span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {value}
        </span>
      </div>
    </div>
  );
}

export default function DesignKitPage(): JSX.Element {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return (
    <main
      style={{
        maxWidth: 1180,
        margin: '0 auto',
        padding: '72px 32px 120px',
        display: 'flex',
        flexDirection: 'column',
        gap: 64,
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <AccrueWordmark size={26} fontSize={24} />
        <h1
          style={{
            margin: 0,
            fontSize: 52,
            fontWeight: 300,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
          }}
        >
          Tokens and mark
        </h1>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SectionHeading index="01" title="The mark" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          <MarkPanel label="Three tones, 24 · 48 · 96">
            <AccrueMark size={24} />
            <AccrueMark size={48} />
            <AccrueMark size={96} />
          </MarkPanel>
          <MarkPanel label="One colour on dark">
            <AccrueMark size={52} monochrome />
            <AccrueWordmark size={28} fontSize={22} monochrome />
          </MarkPanel>
          <MarkPanel label="One colour on light" light>
            <AccrueMark size={52} monochrome monochromeColor="#12110f" />
            <AccrueWordmark
              size={28}
              fontSize={22}
              monochrome
              monochromeColor="#12110f"
            />
          </MarkPanel>
        </div>
      </section>

      {DESIGN_TOKEN_GROUPS.map((group, groupIndex) => (
        <section
          key={group.title}
          style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        >
          <SectionHeading
            index={String(groupIndex + 2).padStart(2, '0')}
            title={group.title}
            note={group.note}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 14,
            }}
          >
            {group.tokens.map((token) => (
              <TokenSwatch key={token.name} name={token.name} value={token.value} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

function SectionHeading({
  index,
  title,
  note,
}: {
  index: string;
  title: string;
  note?: string | undefined;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 16,
        flexWrap: 'wrap',
        borderBottom: '1px solid var(--color-hairline)',
        paddingBottom: 12,
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
        }}
      >
        {index}
      </span>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: '-0.01em' }}>
        {title}
      </h2>
      {note === undefined ? null : (
        <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>{note}</span>
      )}
    </div>
  );
}

function MarkPanel({
  label,
  light = false,
  children,
}: {
  label: string;
  light?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        background: light ? 'var(--color-text)' : 'var(--color-panel)',
        border: '1px solid var(--color-hairline)',
        borderRadius: 14,
        padding: 24,
        minHeight: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 20,
          flexWrap: 'wrap',
          justifyContent: 'center',
          flex: 1,
        }}
      >
        {children}
      </div>
      <span
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
        }}
      >
        {label}
      </span>
    </div>
  );
}
