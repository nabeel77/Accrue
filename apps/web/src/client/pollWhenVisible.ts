'use client';

import { useEffect, useRef } from 'react';

export function usePollWhenVisible(
  read: () => void | Promise<void>,
  everyMilliseconds: number,
): void {
  const latest = useRef(read);
  latest.current = read;

  useEffect(() => {
    let beat: ReturnType<typeof setInterval> | null = null;

    const stop = (): void => {
      if (beat !== null) {
        clearInterval(beat);
        beat = null;
      }
    };

    const start = (): void => {
      if (beat !== null) {
        return;
      }
      beat = setInterval(() => {
        void latest.current();
      }, everyMilliseconds);
    };

    const follow = (): void => {
      if (document.visibilityState === 'visible') {
        void latest.current();
        start();
        return;
      }
      stop();
    };

    follow();
    document.addEventListener('visibilitychange', follow);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', follow);
    };
  }, [everyMilliseconds]);
}
