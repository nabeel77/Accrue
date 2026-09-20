import type { JSX } from 'react';

const WIDTH = 600;
const HEIGHT = 96;
const EDGE = 4;

export interface SparklinePoint {
  readonly atMilliseconds: number;
  readonly equityUsd: number;
}

function pathFor(
  points: readonly SparklinePoint[],
  lowest: number,
  highest: number,
): string {
  const span = highest - lowest;
  const acrossOne = points.length > 1 ? (WIDTH - EDGE * 2) / (points.length - 1) : 0;
  return points
    .map((point, index) => {
      const across = EDGE + index * acrossOne;
      const height = span === 0 ? 0.5 : (point.equityUsd - lowest) / span;
      const down = HEIGHT - EDGE - height * (HEIGHT - EDGE * 2);
      return `${index === 0 ? 'M' : 'L'}${across.toFixed(2)} ${down.toFixed(2)}`;
    })
    .join(' ');
}

export function Sparkline({
  points,
  direction,
  label,
  testId,
}: {
  points: readonly SparklinePoint[];
  direction: 'up' | 'down' | 'flat';
  label: string;
  testId?: string;
}): JSX.Element | null {
  if (points.length < 2) {
    return null;
  }
  const values = points.map((point) => point.equityUsd);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const line = pathFor(points, lowest, highest);
  const colour =
    direction === 'down' ? 'var(--color-health-caution)' : 'var(--color-accent)';

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      data-testid={testId}
      style={{ width: '100%', height: HEIGHT, display: 'block' }}
    >
      <path
        d={`${line} L${WIDTH - EDGE} ${HEIGHT} L${EDGE} ${HEIGHT} Z`}
        fill={colour}
        opacity={0.12}
      />
      <path
        d={line}
        fill="none"
        stroke={colour}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
