const ENTERS_AT = 0.92;
const STAGGER_SECONDS = 0.08;
const HOW_OFTEN = 300;
const FIRST_CHECK = 60;
const MOST_IN_A_ROW = 6;

function partsOf(section: Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const child of Array.from(section.children)) {
    if (!(child instanceof HTMLElement) || child.hasAttribute('data-flow-pin')) {
      continue;
    }
    const spreadRow =
      child.style.display === 'grid' &&
      child.children.length > 1 &&
      child.children.length <= MOST_IN_A_ROW &&
      !child.hasAttribute('data-guard') &&
      !child.classList.contains('tnum');
    const spreadColumn =
      child.tagName === 'DIV' &&
      child.style.flexDirection === 'column' &&
      child.children.length <= 3 &&
      child.style.background === '';
    if (spreadRow || spreadColumn) {
      for (const inner of Array.from(child.children)) {
        if (inner instanceof HTMLElement) {
          found.push(inner);
        }
      }
      continue;
    }
    found.push(child);
  }
  return found;
}

export function revealOnScroll(root: HTMLElement): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return () => undefined;
  }

  const waiting: HTMLElement[] = [];
  root.querySelectorAll('section').forEach((section) => {
    if (section.hasAttribute('data-hero')) {
      return;
    }
    waiting.push(...partsOf(section));
  });

  waiting.forEach((element, index) => {
    element.style.opacity = '0';
    element.style.transform = 'translateY(26px)';
    element.style.transition = 'opacity .7s ease, transform .9s cubic-bezier(.2,.7,.2,1)';
    element.style.transitionDelay = `${(index % 4) * STAGGER_SECONDS}s`;
  });

  const check = (): void => {
    const limit = window.innerHeight * ENTERS_AT;
    for (let index = waiting.length - 1; index >= 0; index -= 1) {
      const element = waiting[index];
      if (element !== undefined && element.getBoundingClientRect().top < limit) {
        element.style.opacity = '1';
        element.style.transform = 'none';
        waiting.splice(index, 1);
      }
    }
  };

  const onScroll = (): void => {
    check();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  const beat = setInterval(check, HOW_OFTEN);
  const first = setTimeout(check, FIRST_CHECK);

  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    clearInterval(beat);
    clearTimeout(first);
  };
}
