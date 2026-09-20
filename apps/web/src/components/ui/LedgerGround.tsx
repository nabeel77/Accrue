'use client';

import { useEffect, useRef, type JSX } from 'react';

import { PaintTheLedger } from './paintTheLedger.js';

export const LEDGER_GROUND =
  'linear-gradient(160deg, #0E1A16 0%, #0B0C0C 38%, #0B0C0C 62%, #16120C 100%)';

const FADE =
  'linear-gradient(180deg, rgba(0,0,0,.35), #000 30%, #000 80%, rgba(0,0,0,.4))';

const BAND =
  'linear-gradient(90deg, rgba(55,185,141,0) 0%, rgba(55,185,141,.22) 30%, rgba(111,216,176,.12) 52%, rgba(226,184,113,.20) 76%, rgba(226,184,113,0) 100%)';

export function LedgerGround(): JSX.Element {
  const ground = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = ground.current;
    const surface = canvas.current;
    if (element === null || surface === null) {
      return;
    }
    const painting = new PaintTheLedger(element, surface);
    return () => {
      painting.stop();
    };
  }, []);

  return (
    <div
      ref={ground}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
        maskImage: FADE,
        WebkitMaskImage: FADE,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '-10%',
          right: '-10%',
          top: '22%',
          height: '38%',
          background: BAND,
          filter: 'blur(40px)',
          transform: 'rotate(-4deg)',
        }}
      />
      <canvas
        ref={canvas}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </div>
  );
}
