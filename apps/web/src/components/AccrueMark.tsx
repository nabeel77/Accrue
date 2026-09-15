import type { JSX } from 'react';

const MARK_VIEWBOX = '0 0 48 48';

const MARK_LEVELS = [
  { points: '11.78,28 36.22,28 44,42 4,42', colorToken: 'var(--color-accent)' },
  {
    points: '17.89,17 30.11,17 35.11,26 12.89,26',
    colorToken: 'var(--color-accent-deep)',
  },
  { points: '24,6 29,15 19,15', colorToken: 'var(--color-accent-deeper)' },
] as const;

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
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      role="img"
      aria-label={title}
      focusable="false"
    >
      {MARK_LEVELS.map((level) => (
        <polygon
          key={level.points}
          points={level.points}
          fill={monochrome ? monochromeColor : level.colorToken}
        />
      ))}
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
          letterSpacing: '-0.02em',
          color: monochrome ? monochromeColor : 'var(--color-text)',
        }}
      >
        accrue
      </span>
    </span>
  );
}
