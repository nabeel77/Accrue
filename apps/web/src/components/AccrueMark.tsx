import type { JSX } from 'react';

const MARK_VIEWBOX = '0 0 48 48';
const STEP_LINE = 'M6 38 H16 V29 H26 V20 H36 V11 H42';
const STEP_STROKE = 4;
const DOT = { cx: 42, cy: 11, r: 3.2 } as const;
const SMALLEST_SIZE_THAT_KEEPS_THE_DOT = 24;

export interface AccrueMarkProps {
  size?: number;
  monochrome?: boolean;
  monochromeColor?: string;
  title?: string;
}

export function AccrueMark({
  size = 20,
  monochrome = false,
  monochromeColor = 'var(--color-text)',
  title = 'Accrue',
}: AccrueMarkProps): JSX.Element {
  const showsTheDot = !monochrome && size >= SMALLEST_SIZE_THAT_KEEPS_THE_DOT;
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      role="img"
      aria-label={title}
      focusable="false"
    >
      <path
        d={STEP_LINE}
        fill="none"
        stroke={monochrome ? monochromeColor : 'var(--color-accent)'}
        strokeWidth={STEP_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showsTheDot ? (
        <circle cx={DOT.cx} cy={DOT.cy} r={DOT.r} fill="var(--color-gold)" />
      ) : null}
    </svg>
  );
}

export interface AccrueWordmarkProps extends AccrueMarkProps {
  fontSize?: number;
}

export function AccrueWordmark({
  size = 20,
  fontSize = 16,
  monochrome = false,
  monochromeColor = 'var(--color-text)',
  title = 'Accrue',
}: AccrueWordmarkProps): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      <AccrueMark
        size={size}
        monochrome={monochrome}
        monochromeColor={monochromeColor}
        title={title}
      />
      <span
        style={{
          fontSize,
          fontWeight: 500,
          letterSpacing: '-0.03em',
          color: monochrome ? monochromeColor : 'var(--color-text)',
        }}
      >
        accrue
      </span>
    </span>
  );
}
