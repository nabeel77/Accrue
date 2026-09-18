const NARROW_STAGE_WIDTH = 780;
const SMOOTHING = 0.15;
const SETTLED = 0.0002;
const DIAL_ARC_LENGTH = 213.2;
const DIAL_CIRCUMFERENCE = 439.8;
const DIAL_MAX_PERCENT = 40;
const BORROWED_AT_TARGET = 400;
const INTEREST_AT_TARGET = 20.2;
const LOAN_BEFORE_GUARD = 400;
const LOAN_AFTER_GUARD = 300;
const LOAN_BAR_BEFORE_PERCENT = 66;
const LOAN_BAR_AFTER_PERCENT = 50;
const LIQUIDATION_LINE_BEFORE = 118;
const LIQUIDATION_LINE_AFTER = 132;
const LIQUIDATION_LABEL_BEFORE = 113;
const LIQUIDATION_LABEL_AFTER = 127;
const LIQUIDATION_PRICE_BEFORE = 117.33;
const LIQUIDATION_PRICE_AFTER = 88.0;
const STOCK_RETURNED = 5.6818;
const DESTINATION_HELD = 398.01;
const FALLBACK_PATH_LENGTH = 400;
const BOOT_RETRY_MILLISECONDS = [60, 140, 300, 600, 1200, 2400] as const;
const HEAL_INTERVAL_MILLISECONDS = 120;
const HEAL_ATTEMPTS = 80;

export const BEAT_RANGES = {
  hero: [0, 0.1],
  keep: [0.09, 0.24],
  borrow: [0.24, 0.38],
  earn: [0.38, 0.5],
  guard: [0.5, 0.68],
  leave: [0.68, 0.88],
  close: [0.88, 1],
} as const;

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

function segment(progress: number, start: number, end: number): number {
  return clamp((progress - start) / (end - start), 0, 1);
}

function easeInOut(time: number): number {
  return time < 0.5 ? 2 * time * time : 1 - Math.pow(-2 * time + 2, 2) / 2;
}

function interpolate(from: number, to: number, time: number): number {
  return from + (to - from) * time;
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatAmount(value: number, decimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

interface Point {
  x: number;
  y: number;
}

interface StageNodes {
  scroll: HTMLElement;
  stage: HTMLElement;
  glowAbove: HTMLElement;
  glowBelow: HTMLElement;
  vignette: HTMLElement;
  rail: HTMLElement;
  railFill: HTMLElement;
  railDots: HTMLElement[];
  hero: HTMLElement;
  heroLines: HTMLElement[];
  heroCanvas: HTMLElement;
  ticker: HTMLElement;
  scrollHint: HTMLElement;
  slot: HTMLElement;
  beatSet: HTMLElement;
  objectColumn: HTMLElement;
  copies: HTMLElement[];
  follow: HTMLElement;
  followValue: HTMLElement;
  yoursBadge: HTMLElement;
  reserve: HTMLElement;
  reserveFill: HTMLElement;
  reserveDock: HTMLElement;
  stream: HTMLElement;
  drops: HTMLElement[];
  dialSlot: HTMLElement;
  dial: HTMLElement;
  dialArc: SVGElement;
  dialLabel: SVGElement;
  destinations: HTMLElement;
  destinationCards: HTMLElement[];
  borrowedNumber: HTMLElement;
  interestNumber: HTMLElement;
  guard: HTMLElement;
  guardTag: HTMLElement;
  stockLine: SVGPathElement;
  guardTick: SVGElement;
  guardTickRing: SVGElement;
  liquidationLine: SVGElement;
  liquidationLabel: SVGElement;
  loanBar: HTMLElement;
  loanText: HTMLElement;
  wallet: HTMLElement;
  walletDock: HTMLElement;
  walletNote: HTMLElement;
  walletStock: HTMLElement;
  walletBorrow: HTMLElement;
  walletDestination: HTMLElement;
  close: HTMLElement;
  closeMark: HTMLElement;
  closeLines: HTMLElement[];
  cursorDot: HTMLElement;
}

function one(root: HTMLElement, selector: string): HTMLElement {
  return found(root.querySelector<HTMLElement>(selector), selector);
}

function oneSvg(root: HTMLElement, selector: string): SVGElement {
  return found(root.querySelector<SVGElement>(selector), selector);
}

function onePath(root: HTMLElement, selector: string): SVGPathElement {
  return found(root.querySelector<SVGPathElement>(selector), selector);
}

function found<Node>(node: Node | null, selector: string): Node {
  if (node === null) {
    throw new Error(`the landing stage is missing ${selector}`);
  }
  return node;
}

function many(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

export interface MotionOptions {
  readonly frozenProgress?: number | null;
  readonly liquidationLabelPrefix: string;
}

class AccrueMotion {
  private readonly root: HTMLElement;
  private readonly nodes: StageNodes;
  private readonly copyLines: Map<number, HTMLElement[]>;
  private readonly frozen: boolean;
  private readonly reducedMotion: boolean;
  private readonly liquidationLabelPrefix: string;

  private progress: number;
  private targetProgress: number;
  private stageWidth = 0;
  private stageHeight = 0;
  private isNarrow = false;
  private slotCentre: Point | null = null;
  private slotBox = { x: 0, y: 0, width: 0, height: 0 };
  private dockPoint: Point = { x: 0, y: 0 };
  private walletPoint: Point = { x: 0, y: 0 };
  private guardPoint: Point = { x: 0, y: 0 };
  private focusPoint: Point = { x: 0, y: 0 };
  private markPoint: Point = { x: 0, y: 0 };
  private stockLineLength = FALLBACK_PATH_LENGTH;

  private stopped = false;
  private frameHandle = 0;
  private healHandle: ReturnType<typeof setInterval> | null = null;
  private healAttempts = 0;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly onResize: () => void;
  private readonly onScroll: () => void;
  private readonly onPointerMove: (event: MouseEvent) => void;

  constructor(root: HTMLElement, options: MotionOptions) {
    const frozenProgress = options.frozenProgress ?? null;
    this.root = root;
    this.liquidationLabelPrefix = options.liquidationLabelPrefix;
    this.frozen = frozenProgress !== null;
    this.progress = frozenProgress ?? 0;
    this.targetProgress = this.progress;
    this.reducedMotion =
      !this.frozen && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.nodes = this.cacheNodes();
    this.copyLines = new Map(
      [2, 3, 4, 5, 6].map((beat) => [
        beat,
        many(this.root, `[data-copy="${beat}"] [data-line]`),
      ]),
    );
    try {
      this.stockLineLength = this.nodes.stockLine.getTotalLength();
    } catch {
      this.stockLineLength = FALLBACK_PATH_LENGTH;
    }

    this.onResize = (): void => {
      this.measure();
      this.paint(this.progress);
    };
    this.onScroll = (): void => {
      this.readScroll();
      if (this.reducedMotion || this.frozen) {
        return;
      }
      this.progress = this.targetProgress;
      this.paint(this.progress);
    };
    this.onPointerMove = (event: MouseEvent): void => {
      this.followTheCursor(event);
    };

    this.boot();
    this.frameHandle = requestAnimationFrame(() => {
      this.boot();
    });
    // Fonts and late layout both move the anchor points, so the stage re measures a few times.
    for (const delay of BOOT_RETRY_MILLISECONDS) {
      this.timers.push(
        setTimeout(() => {
          this.boot();
        }, delay),
      );
    }
    void document.fonts.ready.then(() => {
      this.boot();
    });
    this.healHandle = setInterval(() => {
      if (this.stopped || (this.stageWidth > 0 && this.slotCentre !== null)) {
        this.stopHealing();
        return;
      }
      this.healAttempts += 1;
      if (this.healAttempts > HEAL_ATTEMPTS) {
        this.stopHealing();
        return;
      }
      this.boot();
    }, HEAL_INTERVAL_MILLISECONDS);

    window.addEventListener('resize', this.onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.nodes.stage);
    }
    if (this.reducedMotion || this.frozen) {
      return;
    }
    window.addEventListener('mousemove', this.onPointerMove, { passive: true });
    window.addEventListener('scroll', this.onScroll, { passive: true });
    this.runFrame();
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frameHandle);
    this.stopHealing();
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('mousemove', this.onPointerMove);
    window.removeEventListener('scroll', this.onScroll);
  }

  private stopHealing(): void {
    if (this.healHandle !== null) {
      clearInterval(this.healHandle);
      this.healHandle = null;
    }
  }

  private cacheNodes(): StageNodes {
    const root = this.root;
    return {
      scroll: one(root, '[data-scroll]'),
      stage: one(root, '[data-stage]'),
      glowAbove: one(root, '[data-glow-a]'),
      glowBelow: one(root, '[data-glow-b]'),
      vignette: one(root, '[data-vign]'),
      rail: one(root, '[data-rail]'),
      railFill: one(root, '[data-rail-fill]'),
      railDots: many(root, '[data-rail-dot]'),
      hero: one(root, '[data-hero]'),
      heroLines: many(root, '[data-hero-l]'),
      heroCanvas: one(root, '[data-hero-canvas]'),
      ticker: one(root, '[data-ticker]'),
      scrollHint: one(root, '[data-hint]'),
      slot: one(root, '[data-slot]'),
      beatSet: one(root, '[data-set]'),
      objectColumn: one(root, '[data-objcol]'),
      copies: many(root, '[data-copy]'),
      follow: one(root, '[data-follow]'),
      followValue: one(root, '[data-follow-value]'),
      yoursBadge: one(root, '[data-yours]'),
      reserve: one(root, '[data-reserve]'),
      reserveFill: one(root, '[data-fill]'),
      reserveDock: one(root, '[data-dock]'),
      stream: one(root, '[data-stream]'),
      drops: many(root, '[data-drop]'),
      dialSlot: one(root, '[data-slot2]'),
      dial: one(root, '[data-dial]'),
      dialArc: oneSvg(root, '[data-arc]'),
      dialLabel: oneSvg(root, '[data-ltv]'),
      destinations: one(root, '[data-dests]'),
      destinationCards: many(root, '[data-dest]'),
      borrowedNumber: one(root, '[data-num="borrow"]'),
      interestNumber: one(root, '[data-num="interest"]'),
      guard: one(root, '[data-guard]'),
      guardTag: one(root, '[data-guard-tag]'),
      stockLine: onePath(root, '[data-stock]'),
      guardTick: oneSvg(root, '[data-tick]'),
      guardTickRing: oneSvg(root, '[data-tick-ring]'),
      liquidationLine: oneSvg(root, '[data-liq]'),
      liquidationLabel: oneSvg(root, '[data-liq-label]'),
      loanBar: one(root, '[data-loan-bar]'),
      loanText: one(root, '[data-loan-text]'),
      wallet: one(root, '[data-wallet]'),
      walletDock: one(root, '[data-wallet-dock]'),
      walletNote: one(root, '[data-wallet-note]'),
      walletStock: one(root, '[data-w="stock"]'),
      walletBorrow: one(root, '[data-w="borrow"]'),
      walletDestination: one(root, '[data-w="destination"]'),
      close: one(root, '[data-close]'),
      closeMark: one(root, '[data-close-mark]'),
      closeLines: many(root, '[data-cline]'),
      cursorDot: one(root, '[data-cursor-dot]'),
    };
  }

  private boot(): void {
    if (this.stopped) {
      return;
    }
    if (this.frozen) {
      this.freezeLayout();
    }
    this.measure();
    if (this.reducedMotion) {
      this.applyReducedMotion();
      return;
    }
    this.paint(this.progress);
  }

  private freezeLayout(): void {
    const host = this.root.parentElement;
    this.root.style.height =
      host !== null && host.clientHeight > 0 ? `${host.clientHeight}px` : '100%';
    this.nodes.scroll.style.height = '100%';
    this.nodes.stage.style.position = 'relative';
    this.nodes.stage.style.height = '100%';
    this.nodes.cursorDot.style.display = 'none';
  }

  private readScroll(): void {
    const box = this.nodes.scroll.getBoundingClientRect();
    const span = this.nodes.scroll.offsetHeight - this.nodes.stage.offsetHeight;
    this.targetProgress = clamp(-box.top / Math.max(1, span), 0, 1);
  }

  private followTheCursor(event: MouseEvent): void {
    const box = this.nodes.stage.getBoundingClientRect();
    const dot = this.nodes.cursorDot;
    dot.style.opacity = '1';
    dot.style.transform = `translate(${event.clientX - box.left}px,${event.clientY - box.top}px)`;
    const target = event.target;
    const overLink =
      target instanceof Element && target.closest('[data-cursor]') !== null;
    dot.style.width = overLink ? '38px' : '12px';
    dot.style.height = overLink ? '38px' : '12px';
    dot.style.margin = overLink ? '-19px 0 0 -19px' : '-6px 0 0 -6px';
    dot.style.backgroundColor = overLink
      ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
      : 'transparent';
  }

  private measure(): void {
    const nodes = this.nodes;
    const stage = nodes.stage;
    const stageBox = stage.getBoundingClientRect();
    // A frozen frame is drawn inside a scaled holder, so every measurement divides that scale out.
    const scale = stageBox.width / Math.max(1, stage.offsetWidth);
    this.stageWidth = stage.offsetWidth;
    this.stageHeight = stage.offsetHeight;
    if (this.stageWidth === 0 || this.stageHeight === 0) {
      return;
    }
    this.isNarrow = this.stageWidth < NARROW_STAGE_WIDTH;

    const columns = many(this.root, '[data-set] > div');
    columns.forEach((column, index) => {
      column.style.height = this.isNarrow ? (index === 0 ? '34cqh' : '44cqh') : '62cqh';
    });
    for (const copy of nodes.copies) {
      copy.style.top = this.isNarrow ? '0' : '50%';
      copy.style.transform = this.isNarrow ? 'none' : 'translateY(-50%)';
    }
    nodes.beatSet.style.alignItems = this.isNarrow ? 'flex-start' : 'center';
    nodes.beatSet.style.paddingTop = this.isNarrow ? '9cqh' : '13cqh';
    nodes.reserve.style.height = this.isNarrow ? '15cqh' : '26cqh';
    nodes.reserve.style.width = this.isNarrow ? 'min(100%, 27cqh)' : 'min(100%, 38cqh)';
    nodes.stream.style.height = this.isNarrow ? '4cqh' : '7cqh';
    nodes.dialSlot.style.height = this.isNarrow ? '21cqh' : '24cqh';
    nodes.dial.style.width = this.isNarrow ? 'min(62%, 15cqh)' : 'min(80%, 22cqh)';

    // Every anchor inside the object column is read with its own travel undone, so the points
    // do not drift with whatever the last frame painted.
    const columnTransform = nodes.objectColumn.style.transform;
    nodes.objectColumn.style.transform = 'none';
    const slotBox = nodes.slot.getBoundingClientRect();
    const dockBox = nodes.reserveDock.getBoundingClientRect();
    const walletDockBox = nodes.walletDock.getBoundingClientRect();
    const guardCard = nodes.guard.firstElementChild ?? nodes.guard;
    const guardBox = guardCard.getBoundingClientRect();
    nodes.objectColumn.style.transform = columnTransform;

    this.slotBox = {
      x: (slotBox.left - stageBox.left) / scale,
      y: (slotBox.top - stageBox.top) / scale,
      width: slotBox.width / scale,
      height: slotBox.height / scale,
    };
    this.dockPoint = {
      x: (dockBox.left - stageBox.left) / scale,
      y: (dockBox.top - stageBox.top) / scale,
    };
    this.walletPoint = {
      x: (walletDockBox.left + walletDockBox.width / 2 - stageBox.left) / scale,
      y: (walletDockBox.top + walletDockBox.height / 2 - stageBox.top) / scale,
    };
    const tokenHeight = this.slotBox.height * (this.isNarrow ? 0.7 : 0.78);
    this.guardPoint = {
      x: (guardBox.left + guardBox.width / 2 - stageBox.left) / scale,
      y:
        (guardBox.top - stageBox.top) / scale -
        tokenHeight / 2 -
        (this.isNarrow ? 10 : 16),
    };
    this.focusPoint = {
      x: this.stageWidth * 0.5,
      y: this.stageHeight * (this.isNarrow ? 0.44 : 0.5),
    };
    this.markPoint = { x: this.stageWidth * 0.5, y: this.stageHeight * 0.4 };

    nodes.follow.style.left = `${this.slotBox.x}px`;
    nodes.follow.style.top = `${this.slotBox.y}px`;
    nodes.follow.style.width = `${this.slotBox.width}px`;
    nodes.follow.style.height = `${this.slotBox.height}px`;
    this.slotCentre = {
      x: this.slotBox.x + this.slotBox.width / 2,
      y: this.slotBox.y + this.slotBox.height / 2,
    };
  }

  private runFrame(): void {
    if (this.stopped) {
      return;
    }
    this.advance();
    this.frameHandle = requestAnimationFrame(() => {
      this.runFrame();
    });
  }

  private advance(): void {
    if (this.stageWidth === 0 || this.stageHeight === 0 || this.slotCentre === null) {
      this.measure();
    }
    this.readScroll();
    this.progress += (this.targetProgress - this.progress) * SMOOTHING;
    if (Math.abs(this.targetProgress - this.progress) < SETTLED) {
      this.progress = this.targetProgress;
    }
    this.paint(this.progress);
  }

  private fadeLines(
    lines: readonly HTMLElement[],
    progress: number,
    start: number,
    hold: number,
    end: number,
    stagger = 0.018,
  ): void {
    lines.forEach((line, index) => {
      const arriving = easeInOut(
        segment(progress, start + index * stagger, start + 0.06 + index * stagger),
      );
      const leaving = segment(progress, hold, end);
      line.style.opacity = (arriving * (1 - leaving)).toFixed(3);
      line.style.transform = `translate3d(0,${(
        interpolate(22, 0, arriving) -
        leaving * 22
      ).toFixed(1)}px,0)`;
    });
  }

  private applyReducedMotion(): void {
    const nodes = this.nodes;
    nodes.stage.style.position = 'static';
    nodes.stage.style.height = 'auto';
    nodes.scroll.style.height = 'auto';
    nodes.hero.style.position = 'static';
    nodes.hero.style.minHeight = '76vh';
    nodes.follow.style.display = 'none';
    nodes.scrollHint.style.display = 'none';
    nodes.cursorDot.style.display = 'none';
    nodes.rail.style.display = 'none';
    nodes.beatSet.style.position = 'static';
    nodes.beatSet.style.display = 'grid';
    nodes.beatSet.style.gap = '8vh';
    nodes.beatSet.style.pointerEvents = 'auto';
    for (const column of many(this.root, '[data-set] > div')) {
      column.style.height = 'auto';
      column.style.flex = '1 1 100%';
    }
    for (const copy of nodes.copies) {
      copy.style.position = 'static';
      copy.style.transform = 'none';
      copy.style.opacity = '1';
      copy.style.marginBottom = '7vh';
    }
    for (const line of many(this.root, '[data-line], [data-cline]')) {
      line.style.opacity = '1';
      line.style.transform = 'none';
    }
    for (const object of [
      nodes.reserve,
      nodes.dial,
      nodes.destinations,
      nodes.guard,
      nodes.wallet,
      nodes.close,
    ]) {
      object.style.position = 'static';
      object.style.transform = 'none';
      object.style.opacity = '1';
      object.style.margin = '0 auto 5vh';
    }
    nodes.close.style.pointerEvents = 'auto';
    nodes.reserveFill.style.height = '56%';
    nodes.dialArc.setAttribute(
      'stroke-dasharray',
      `${DIAL_ARC_LENGTH} ${DIAL_CIRCUMFERENCE}`,
    );
    nodes.dialLabel.textContent = `${DIAL_MAX_PERCENT.toFixed(1)}%`;
    nodes.stream.style.display = 'none';
    nodes.borrowedNumber.textContent = formatUsd(BORROWED_AT_TARGET);
    nodes.interestNumber.textContent = formatUsd(INTEREST_AT_TARGET);
    nodes.stockLine.setAttribute('stroke-dasharray', '1000 0');
    nodes.guardTick.setAttribute('r', '4');
    nodes.guardTick.setAttribute('opacity', '1');
    nodes.guardTag.style.opacity = '1';
    nodes.loanBar.style.width = `${LOAN_BAR_AFTER_PERCENT}%`;
    nodes.loanText.textContent = formatUsd(LOAN_AFTER_GUARD);
    nodes.walletStock.textContent = formatAmount(STOCK_RETURNED, 4);
    nodes.walletDestination.textContent = formatAmount(0, 2);
    nodes.walletNote.style.opacity = '1';
  }

  private paint(progress: number): void {
    if (this.stageWidth === 0 || this.stageHeight === 0 || this.slotCentre === null) {
      this.measure();
    }
    const slotCentre = this.slotCentre;
    if (this.stageWidth === 0 || slotCentre === null) {
      return;
    }
    const nodes = this.nodes;
    const width = this.stageWidth;
    const height = this.stageHeight;

    nodes.glowAbove.style.transform = `translate3d(${interpolate(
      0,
      -width * 0.08,
      progress,
    ).toFixed(
      1,
    )}px,${interpolate(-height * 0.06, height * 0.14, progress).toFixed(1)}px,0)`;
    nodes.glowAbove.style.opacity = interpolate(
      0.4,
      0.95,
      segment(progress, 0, 0.4),
    ).toFixed(3);
    nodes.glowBelow.style.opacity = (
      segment(progress, BEAT_RANGES.earn[0], BEAT_RANGES.earn[1]) *
      0.9 *
      (1 - segment(progress, BEAT_RANGES.close[0] - 0.04, BEAT_RANGES.close[0] + 0.02))
    ).toFixed(3);
    nodes.vignette.style.opacity = interpolate(0.22, 0.55, progress).toFixed(3);

    nodes.railFill.style.height = `${(progress * 100).toFixed(2)}%`;
    const marks = [
      0,
      BEAT_RANGES.keep[0] + 0.03,
      BEAT_RANGES.borrow[0],
      BEAT_RANGES.earn[0],
      BEAT_RANGES.guard[0],
      BEAT_RANGES.leave[0],
    ];
    let activeMark = 0;
    marks.forEach((mark, index) => {
      if (progress >= mark) {
        activeMark = index;
      }
    });
    nodes.railDots.forEach((dot, index) => {
      dot.style.color =
        index === activeMark ? 'var(--color-accent)' : 'var(--color-text-muted)';
    });

    const wake = segment(progress, 0.005, 0.07);
    const dim = segment(progress, 0.05, 0.12);
    nodes.heroCanvas.style.opacity = (1 - 0.7 * dim).toFixed(3);
    nodes.heroCanvas.style.transform = `translate3d(0,${interpolate(
      0,
      -height * 0.05,
      segment(progress, 0, 0.16),
    ).toFixed(1)}px,0) scale(${interpolate(1, 1.04, dim).toFixed(3)})`;
    nodes.ticker.style.opacity = (1 - segment(progress, 0.02, 0.07)).toFixed(3);
    nodes.follow.style.visibility = wake > 0.02 ? 'visible' : 'hidden';
    nodes.hero.style.pointerEvents = progress > 0.1 ? 'none' : 'auto';
    nodes.hero.style.opacity = (1 - segment(progress, 0.1, 0.16)).toFixed(3);
    nodes.heroLines.forEach((line, index) => {
      const leaving = segment(progress, 0.035 + index * 0.012, 0.085 + index * 0.012);
      line.style.transform = `translate3d(0,${(-leaving * height * 0.06).toFixed(1)}px,0)`;
      line.style.opacity = (1 - leaving).toFixed(3);
    });
    nodes.scrollHint.style.opacity = (1 - segment(progress, 0, 0.03)).toFixed(3);

    const toFocus = easeInOut(segment(progress, 0.04, 0.12));
    const toDock = easeInOut(segment(progress, 0.14, 0.22));
    const toGuard = easeInOut(
      segment(progress, BEAT_RANGES.guard[0] - 0.02, BEAT_RANGES.guard[0] + 0.05),
    );
    const toWallet = easeInOut(
      segment(progress, BEAT_RANGES.leave[0], BEAT_RANGES.leave[0] + 0.06),
    );
    const toMark = easeInOut(
      segment(progress, BEAT_RANGES.close[0] - 0.02, BEAT_RANGES.close[0] + 0.03),
    );
    let followX = interpolate(slotCentre.x, this.focusPoint.x, toFocus);
    let followY = interpolate(slotCentre.y, this.focusPoint.y, toFocus);
    followX = interpolate(followX, this.dockPoint.x, toDock);
    followY = interpolate(followY, this.dockPoint.y, toDock);
    followX = interpolate(followX, this.guardPoint.x, toGuard);
    followY = interpolate(followY, this.guardPoint.y, toGuard);
    followX = interpolate(followX, this.walletPoint.x, toWallet);
    followY = interpolate(followY, this.walletPoint.y, toWallet);
    followX = interpolate(followX, this.markPoint.x, toMark);
    followY = interpolate(followY, this.markPoint.y, toMark);
    let followScale = interpolate(1, this.isNarrow ? 1.45 : 1.85, toFocus);
    followScale = interpolate(followScale, this.isNarrow ? 0.82 : 0.92, toDock);
    followScale = interpolate(followScale, this.isNarrow ? 0.7 : 0.78, toGuard);
    followScale = interpolate(followScale, this.isNarrow ? 0.78 : 0.9, toWallet);
    followScale = interpolate(followScale, 0.3, toMark);
    nodes.follow.style.opacity = (
      1 - segment(progress, BEAT_RANGES.close[0] - 0.01, BEAT_RANGES.close[0] + 0.03)
    ).toFixed(3);
    nodes.follow.style.transform = `translate3d(${(followX - slotCentre.x).toFixed(1)}px,${(
      followY - slotCentre.y
    ).toFixed(1)}px,0) scale(${followScale.toFixed(3)})`;
    const followGlow = segment(progress, 0.02, 0.08);
    nodes.follow.style.boxShadow = `0 0 0 1px ${
      followGlow > 0.5 ? 'var(--color-accent)' : 'var(--color-hairline)'
    }, 0 ${(18 * followGlow).toFixed(0)}px ${(54 * followGlow).toFixed(
      0,
    )}px color-mix(in srgb, var(--color-accent) ${(20 * followGlow).toFixed(1)}%, transparent)`;
    nodes.followValue.style.opacity = segment(progress, 0.08, 0.14).toFixed(3);
    nodes.yoursBadge.style.opacity = (
      segment(progress, 0.16, 0.22) *
      (1 - segment(progress, BEAT_RANGES.close[0] - 0.03, BEAT_RANGES.close[0]))
    ).toFixed(3);

    const reserveIn = easeInOut(
      segment(progress, BEAT_RANGES.keep[0], BEAT_RANGES.keep[0] + 0.07),
    );
    const objectsOut = segment(
      progress,
      BEAT_RANGES.guard[0] - 0.03,
      BEAT_RANGES.guard[0] + 0.01,
    );
    nodes.reserve.style.opacity = (reserveIn * (1 - objectsOut)).toFixed(3);
    nodes.reserve.style.transform = `translate3d(0,${interpolate(
      height * 0.05,
      0,
      reserveIn,
    ).toFixed(1)}px,0) scale(${interpolate(0.94, 1, reserveIn).toFixed(3)})`;
    nodes.reserveFill.style.height = `${(easeInOut(segment(progress, 0.15, 0.23)) * 100).toFixed(2)}%`;
    nodes.objectColumn.style.transform = `translate3d(0,${interpolate(
      height * (this.isNarrow ? 0.07 : 0.115),
      0,
      easeInOut(
        segment(progress, BEAT_RANGES.borrow[0] - 0.03, BEAT_RANGES.borrow[0] + 0.05),
      ),
    ).toFixed(1)}px,0)`;
    this.fadeLines(
      this.copyLines.get(2) ?? [],
      progress,
      BEAT_RANGES.keep[0],
      BEAT_RANGES.borrow[0] - 0.03,
      BEAT_RANGES.borrow[0] + 0.01,
    );

    this.fadeLines(
      this.copyLines.get(3) ?? [],
      progress,
      BEAT_RANGES.borrow[0],
      BEAT_RANGES.earn[0] - 0.03,
      BEAT_RANGES.earn[0] + 0.01,
    );
    const streamIn = segment(
      progress,
      BEAT_RANGES.borrow[0],
      BEAT_RANGES.borrow[0] + 0.06,
    );
    nodes.stream.style.opacity = (streamIn * (1 - objectsOut)).toFixed(3);
    const streamHeight = nodes.stream.offsetHeight || 1;
    nodes.drops.forEach((drop, index) => {
      const along =
        (((index / nodes.drops.length + (progress - BEAT_RANGES.borrow[0]) * 3.4) % 1) +
          1) %
        1;
      drop.style.transform = `translate(-50%,${(along * streamHeight).toFixed(1)}px)`;
      drop.style.opacity = Math.sin(Math.PI * along).toFixed(3);
    });
    const dialIn = easeInOut(
      segment(progress, BEAT_RANGES.borrow[0], BEAT_RANGES.borrow[0] + 0.06),
    );
    nodes.dial.style.opacity = (
      dialIn *
      (1 - segment(progress, BEAT_RANGES.earn[0] - 0.02, BEAT_RANGES.earn[0] + 0.02))
    ).toFixed(3);
    nodes.dial.style.transform = `translate3d(0,${interpolate(height * 0.04, 0, dialIn).toFixed(1)}px,0)`;
    const dialFill = easeInOut(
      segment(progress, BEAT_RANGES.borrow[0] + 0.03, BEAT_RANGES.borrow[1] - 0.02),
    );
    nodes.dialArc.setAttribute(
      'stroke-dasharray',
      `${(dialFill * DIAL_ARC_LENGTH).toFixed(1)} ${DIAL_CIRCUMFERENCE}`,
    );
    nodes.dialLabel.textContent = `${(dialFill * DIAL_MAX_PERCENT).toFixed(1)}%`;
    nodes.borrowedNumber.textContent = formatUsd(dialFill * BORROWED_AT_TARGET);
    nodes.interestNumber.textContent = formatUsd(dialFill * INTEREST_AT_TARGET);

    this.fadeLines(
      this.copyLines.get(4) ?? [],
      progress,
      BEAT_RANGES.earn[0],
      BEAT_RANGES.guard[0] - 0.03,
      BEAT_RANGES.guard[0] + 0.01,
    );
    const destinationsIn = segment(
      progress,
      BEAT_RANGES.earn[0],
      BEAT_RANGES.earn[0] + 0.05,
    );
    nodes.destinations.style.opacity = (destinationsIn * (1 - objectsOut)).toFixed(3);
    nodes.destinationCards.forEach((card, index) => {
      const arriving = easeInOut(
        segment(
          progress,
          BEAT_RANGES.earn[0] + 0.01 + index * 0.02,
          BEAT_RANGES.earn[0] + 0.06 + index * 0.02,
        ),
      );
      card.style.transform = `translate3d(0,${interpolate(18, 0, arriving).toFixed(1)}px,0)`;
      card.style.opacity = (0.25 + 0.75 * arriving).toFixed(3);
      card.style.boxShadow =
        arriving > 0.6
          ? '0 0 0 1px var(--color-accent-deep)'
          : '0 0 0 1px var(--color-hairline)';
    });

    this.fadeLines(
      this.copyLines.get(5) ?? [],
      progress,
      BEAT_RANGES.guard[0],
      BEAT_RANGES.leave[0] - 0.03,
      BEAT_RANGES.leave[0] + 0.01,
    );
    const guardIn = easeInOut(
      segment(progress, BEAT_RANGES.guard[0], BEAT_RANGES.guard[0] + 0.05),
    );
    const guardOut = segment(
      progress,
      BEAT_RANGES.leave[0] - 0.03,
      BEAT_RANGES.leave[0] + 0.01,
    );
    nodes.guard.style.opacity = (guardIn * (1 - guardOut)).toFixed(3);
    nodes.guard.style.transform = `translate3d(0,${interpolate(height * 0.04, 0, guardIn).toFixed(1)}px,0)`;
    const drawn = easeInOut(
      segment(progress, BEAT_RANGES.guard[0] + 0.02, BEAT_RANGES.guard[0] + 0.075),
    );
    nodes.stockLine.setAttribute(
      'stroke-dasharray',
      `${(drawn * this.stockLineLength).toFixed(1)} ${this.stockLineLength.toFixed(1)}`,
    );
    const tickFires = segment(
      progress,
      BEAT_RANGES.guard[0] + 0.07,
      BEAT_RANGES.guard[0] + 0.09,
    );
    const tickRing = segment(
      progress,
      BEAT_RANGES.guard[0] + 0.075,
      BEAT_RANGES.guard[0] + 0.115,
    );
    nodes.guardTick.setAttribute('r', (4 * easeInOut(tickFires)).toFixed(2));
    nodes.guardTick.setAttribute('opacity', tickFires > 0 ? '1' : '0');
    nodes.guardTickRing.setAttribute('r', (6 + 14 * tickRing).toFixed(1));
    nodes.guardTickRing.setAttribute(
      'opacity',
      (tickFires > 0 ? 1 - tickRing : 0).toFixed(3),
    );
    const repaid = easeInOut(
      segment(progress, BEAT_RANGES.guard[0] + 0.085, BEAT_RANGES.guard[0] + 0.13),
    );
    nodes.loanBar.style.width = `${interpolate(
      LOAN_BAR_BEFORE_PERCENT,
      LOAN_BAR_AFTER_PERCENT,
      repaid,
    ).toFixed(1)}%`;
    nodes.loanText.textContent = formatUsd(
      interpolate(LOAN_BEFORE_GUARD, LOAN_AFTER_GUARD, repaid),
    );
    const liquidationY = interpolate(
      LIQUIDATION_LINE_BEFORE,
      LIQUIDATION_LINE_AFTER,
      repaid,
    ).toFixed(1);
    nodes.liquidationLine.setAttribute('y1', liquidationY);
    nodes.liquidationLine.setAttribute('y2', liquidationY);
    nodes.liquidationLabel.setAttribute(
      'y',
      interpolate(LIQUIDATION_LABEL_BEFORE, LIQUIDATION_LABEL_AFTER, repaid).toFixed(1),
    );
    nodes.liquidationLabel.textContent = `${this.liquidationLabelPrefix}${formatUsd(
      interpolate(LIQUIDATION_PRICE_BEFORE, LIQUIDATION_PRICE_AFTER, repaid),
    )}`;
    nodes.guardTag.style.opacity = segment(
      progress,
      BEAT_RANGES.guard[0] + 0.085,
      BEAT_RANGES.guard[0] + 0.11,
    ).toFixed(3);

    this.fadeLines(
      this.copyLines.get(6) ?? [],
      progress,
      BEAT_RANGES.leave[0],
      BEAT_RANGES.close[0] - 0.03,
      BEAT_RANGES.close[0] + 0.01,
    );
    const walletIn = easeInOut(
      segment(progress, BEAT_RANGES.leave[0] - 0.01, BEAT_RANGES.leave[0] + 0.05),
    );
    const walletOut = segment(
      progress,
      BEAT_RANGES.close[0] - 0.03,
      BEAT_RANGES.close[0] + 0.01,
    );
    nodes.wallet.style.opacity = (walletIn * (1 - walletOut)).toFixed(3);
    nodes.wallet.style.transform = `translate3d(0,${interpolate(height * 0.04, 0, walletIn).toFixed(1)}px,0)`;
    const returned = easeInOut(
      segment(progress, BEAT_RANGES.leave[0] + 0.04, BEAT_RANGES.leave[0] + 0.1),
    );
    nodes.walletStock.textContent = formatAmount(STOCK_RETURNED * returned, 4);
    nodes.walletDestination.textContent = formatAmount(
      interpolate(DESTINATION_HELD, 0, returned) * (returned > 0 ? 1 : 0),
      2,
    );
    nodes.walletBorrow.textContent = formatAmount(0, 2);
    nodes.walletNote.style.opacity = segment(
      progress,
      BEAT_RANGES.leave[0] + 0.09,
      BEAT_RANGES.leave[0] + 0.12,
    ).toFixed(3);

    const closeIn = segment(
      progress,
      BEAT_RANGES.close[0] + 0.03,
      BEAT_RANGES.close[0] + 0.08,
    );
    nodes.close.style.opacity = closeIn.toFixed(3);
    nodes.close.style.pointerEvents = closeIn > 0.8 ? 'auto' : 'none';
    nodes.closeMark.style.transform = `scale(${interpolate(0.6, 1, easeInOut(closeIn)).toFixed(3)})`;
    this.fadeLines(
      nodes.closeLines,
      progress,
      BEAT_RANGES.close[0] + 0.05,
      1.4,
      1.5,
      0.016,
    );
  }
}

export interface MountedMotion {
  stop: () => void;
}

export function mountAccrueMotion(
  root: HTMLElement,
  options: MotionOptions,
): MountedMotion {
  const motion = new AccrueMotion(root, options);
  return {
    stop: () => {
      motion.stop();
    },
  };
}
