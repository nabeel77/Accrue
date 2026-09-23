import { FLOW_STEPS } from './flowFrames.js';

const VIEWPORTS_PER_STEP = 0.62;
const STICKY_GAP = 72;
const MANUAL_HOLD = 900;

export interface PinnedFlow {
  readonly jumpTo: (step: number) => void;
  readonly stop: () => void;
}

export function pinTheFlow(
  pin: HTMLElement,
  card: HTMLElement,
  goToStep: (step: number) => void,
): PinnedFlow {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { jumpTo: () => undefined, stop: () => undefined };
  }

  pin.style.minHeight = `${FLOW_STEPS * VIEWPORTS_PER_STEP * 100 + 100}vh`;
  card.style.position = 'sticky';

  const place = (): void => {
    card.style.top = `${Math.max(
      STICKY_GAP,
      Math.round((window.innerHeight - card.offsetHeight) / 2),
    )}px`;
  };
  place();
  window.addEventListener('resize', place);
  const settle = setTimeout(place, 400);

  let manualUntil = 0;

  const spanOfTheScrub = (): { top: number; span: number } => {
    const box = pin.getBoundingClientRect();
    return { top: box.top, span: box.height - card.offsetHeight - STICKY_GAP };
  };

  const read = (): void => {
    if (performance.now() < manualUntil) {
      return;
    }
    const { top, span } = spanOfTheScrub();
    if (span <= 0) {
      return;
    }
    const along = Math.min(0.999, Math.max(0, (-top + STICKY_GAP) / span));
    goToStep(Math.floor(along * FLOW_STEPS));
  };
  window.addEventListener('scroll', read, { passive: true });
  read();

  const jumpTo = (step: number): void => {
    const { top, span } = spanOfTheScrub();
    manualUntil = performance.now() + MANUAL_HOLD;
    goToStep(step);
    window.scrollTo({
      top: window.scrollY + top - STICKY_GAP + span * ((step + 0.5) / FLOW_STEPS),
      behavior: 'smooth',
    });
  };

  return {
    jumpTo,
    stop: () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', read);
      clearTimeout(settle);
    },
  };
}
