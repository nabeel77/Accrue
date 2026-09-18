'use client';

import type { JSX } from 'react';

const A_NUMBER = /(\$?\d[\d,]*(?:\.\d+)?)/gu;

export function NumbersInMono({ sentence }: { sentence: string }): JSX.Element {
  return (
    <>
      {sentence.split(A_NUMBER).map((piece, index) =>
        A_NUMBER.test(piece) && index % 2 === 1 ? (
          <span
            key={`${piece}-${index}`}
            className="mono"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {piece}
          </span>
        ) : (
          <span key={`${piece}-${index}`}>{piece}</span>
        ),
      )}
    </>
  );
}
