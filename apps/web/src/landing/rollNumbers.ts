const LOOKS_LIKE_A_NUMBER = /^[+\-−$]?\$?[0-9][0-9,.]*%?$/;
const PARTS = /^([+\-−]?)(\$?)([0-9,]+)(\.([0-9]+))?(%?)$/;
const ROLL_MILLISECONDS = 1_100;
const VISIBLE_ENOUGH = 0.6;

function easeInOut(fraction: number): number {
  return fraction < 0.5
    ? 2 * fraction * fraction
    : 1 - Math.pow(-2 * fraction + 2, 2) / 2;
}

export function rollNumbersIntoView(root: HTMLElement): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return () => undefined;
  }

  const watcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        watcher.unobserve(entry.target);
        const element = entry.target as HTMLElement;
        const final = element.textContent.trim();
        const parts = PARTS.exec(final);
        if (parts === null) {
          continue;
        }
        const whole = parts[3]?.replace(/,/g, '') ?? '';
        const target = Number.parseFloat(whole + (parts[4] ?? ''));
        const places = parts[5]?.length ?? 0;
        const startedAt = performance.now();
        const walk = (now: number): void => {
          const along = easeInOut(
            Math.min(1, Math.max(0, (now - startedAt) / ROLL_MILLISECONDS)),
          );
          if (along < 1) {
            element.textContent = `${parts[1] ?? ''}${parts[2] ?? ''}${(
              target * along
            ).toLocaleString('en-US', {
              minimumFractionDigits: places,
              maximumFractionDigits: places,
            })}${parts[6] ?? ''}`;
            requestAnimationFrame(walk);
            return;
          }
          element.textContent = final;
        };
        requestAnimationFrame(walk);
      }
    },
    { threshold: VISIBLE_ENOUGH },
  );

  for (const found of Array.from(root.querySelectorAll('.tnum'))) {
    if (!(found instanceof HTMLElement) || found.children.length > 0) {
      continue;
    }
    if (!LOOKS_LIKE_A_NUMBER.test(found.textContent.trim())) {
      continue;
    }
    if (found.closest('[data-guard], [data-flow], [data-hero]') !== null) {
      continue;
    }
    watcher.observe(found);
  }

  return () => {
    watcher.disconnect();
  };
}
