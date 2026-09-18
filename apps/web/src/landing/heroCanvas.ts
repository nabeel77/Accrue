import { withAlpha, type HeroPalette } from './palette.js';

const DRAW_SECONDS = 12;
const DIP_EVERY_SECONDS = 20;
const DIP_LENGTH_SECONDS = 2;
const POINT_SPACING_PIXELS = 2;
const NARROW_WIDTH = 780;
const SIMULATION_SEED = 20260915;
const TICKER_PIXELS_PER_SECOND = 20;
const THROTTLE_FALLBACK_MILLISECONDS = 250;
const GRID_SPACING_PIXELS = 80;
const GUARD_LABEL_SECONDS = 3;

function easeInOut(time: number): number {
  return time < 0.5 ? 2 * time * time : 1 - Math.pow(-2 * time + 2, 2) / 2;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface PricePoint {
  readonly x: number;
  readonly y: number;
}

interface GuardTick {
  readonly atSeconds: number;
  readonly x: number;
  readonly y: number;
}

interface Simulation {
  points: PricePoint[];
  random: () => number;
  y: number;
  guardTicks: GuardTick[];
  dipIndex: number;
  firedInThisDip: boolean;
}

export interface HeroLabels {
  readonly liquidationLabel: string;
  readonly guardTickLabel: string;
  readonly gridLabels: readonly string[];
}

class LivingHero {
  private readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly tickerTrack: HTMLElement | null;
  private readonly palette: HeroPalette;
  private readonly labels: HeroLabels;
  private readonly frozenSeconds: number | null;
  private readonly reducedMotion: boolean;

  private context: CanvasRenderingContext2D | null = null;
  private width = 1;
  private height = 1;
  private isNarrow = false;
  private headPixels = 1;
  private pixelsPerSecond = 1;
  private liquidationBaseY = 1;
  private simulation: Simulation | null = null;
  private pointerOffset = { x: 0, y: 0 };
  private tickerPaused = false;
  private startedAt = 0;
  private frameHandle = 0;
  private frameRan = false;
  private stopped = false;
  private readonly throttleHandle: ReturnType<typeof setInterval> | null = null;
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly onPointerMove: (event: MouseEvent) => void;
  private readonly onTickerEnter: () => void;
  private readonly onTickerLeave: () => void;

  constructor(
    element: HTMLElement,
    canvas: HTMLCanvasElement,
    palette: HeroPalette,
    labels: HeroLabels,
    frozenSeconds: number | null,
  ) {
    this.element = element;
    this.canvas = canvas;
    this.tickerTrack = element.querySelector<HTMLElement>('[data-ticker-track]');
    this.palette = palette;
    this.labels = labels;
    this.frozenSeconds = frozenSeconds;
    this.reducedMotion =
      frozenSeconds === null &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.onPointerMove = (event: MouseEvent): void => {
      const box = this.element.getBoundingClientRect();
      this.pointerOffset = {
        x: ((event.clientX - box.left) / Math.max(1, box.width) - 0.5) * 2,
        y: ((event.clientY - box.top) / Math.max(1, box.height) - 0.5) * 2,
      };
    };
    this.onTickerEnter = (): void => {
      this.tickerPaused = true;
    };
    this.onTickerLeave = (): void => {
      this.tickerPaused = false;
    };

    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
        this.renderStill();
      });
      this.resizeObserver.observe(element);
    }
    const tickerWindow = this.tickerTrack?.parentElement ?? null;
    tickerWindow?.addEventListener('mouseenter', this.onTickerEnter);
    tickerWindow?.addEventListener('mouseleave', this.onTickerLeave);

    if (frozenSeconds !== null || this.reducedMotion) {
      this.renderStill();
      return;
    }
    if (!this.isNarrow) {
      window.addEventListener('mousemove', this.onPointerMove, { passive: true });
    }
    this.startedAt = performance.now();
    this.frameHandle = requestAnimationFrame((now) => {
      this.runFrame(now);
    });
    // A hidden tab throttles animation frames, so a timer keeps the line moving.
    this.throttleHandle = setInterval(() => {
      if (!this.frameRan) {
        this.drawAtTime((performance.now() - this.startedAt) / 1000);
      }
      this.frameRan = false;
    }, THROTTLE_FALLBACK_MILLISECONDS);
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frameHandle);
    if (this.throttleHandle !== null) {
      clearInterval(this.throttleHandle);
    }
    this.resizeObserver?.disconnect();
    window.removeEventListener('mousemove', this.onPointerMove);
    const tickerWindow = this.tickerTrack?.parentElement ?? null;
    tickerWindow?.removeEventListener('mouseenter', this.onTickerEnter);
    tickerWindow?.removeEventListener('mouseleave', this.onTickerLeave);
  }

  private resize(): void {
    const box = this.element.getBoundingClientRect();
    const devicePixels = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.round(this.element.clientWidth || box.width));
    this.height = Math.max(1, Math.round(this.element.clientHeight || box.height));
    this.isNarrow = this.width < NARROW_WIDTH;
    this.canvas.width = this.width * devicePixels;
    this.canvas.height = this.height * devicePixels;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    const context = this.canvas.getContext('2d');
    if (context === null) {
      return;
    }
    context.setTransform(devicePixels, 0, 0, devicePixels, 0, 0);
    this.context = context;
    this.headPixels = (this.width * 2) / 3;
    this.pixelsPerSecond = this.headPixels / DRAW_SECONDS;
    this.liquidationBaseY = this.height * 0.6;
    this.simulation = null;
  }

  private simulate(seconds: number): Simulation {
    const height = this.height;
    this.simulation ??= {
      points: [],
      random: seededRandom(SIMULATION_SEED),
      y: height * 0.42,
      guardTicks: [],
      dipIndex: -1,
      firedInThisDip: false,
    };
    const simulation = this.simulation;
    const wanted = Math.floor((this.pixelsPerSecond * seconds) / POINT_SPACING_PIXELS);
    while (simulation.points.length <= wanted) {
      const pointX = simulation.points.length * POINT_SPACING_PIXELS;
      const atSeconds = pointX / this.pixelsPerSecond;
      const random = simulation.random;
      const noise = (random() + random() - 1) * 1.6;
      let step = noise - 0.045;
      const dip = Math.floor((atSeconds - DIP_EVERY_SECONDS) / DIP_EVERY_SECONDS);
      const inDip =
        atSeconds >= DIP_EVERY_SECONDS &&
        atSeconds - (DIP_EVERY_SECONDS + dip * DIP_EVERY_SECONDS) < DIP_LENGTH_SECONDS;
      const liquidationY = this.liquidationLineAt(atSeconds, simulation.guardTicks);
      if (inDip) {
        if (dip !== simulation.dipIndex) {
          simulation.dipIndex = dip;
          simulation.firedInThisDip = false;
        }
        step += (liquidationY - simulation.y) * 0.035 + 0.6;
        // The guard fires once per dip, when the line comes near the liquidation line.
        if (
          !simulation.firedInThisDip &&
          Math.abs(simulation.y - liquidationY) < 0.15 * height
        ) {
          simulation.firedInThisDip = true;
          simulation.guardTicks.push({ atSeconds, x: pointX, y: simulation.y });
        }
      } else {
        step += (height * 0.42 - simulation.y) * 0.004;
      }
      simulation.y += step;
      if (simulation.y < height * 0.2) {
        simulation.y = height * 0.2 + (height * 0.2 - simulation.y) * 0.5;
      }
      if (simulation.y > height * 0.82) {
        simulation.y = height * 0.82 - (simulation.y - height * 0.82) * 0.5;
      }
      simulation.points.push({ x: pointX, y: simulation.y });
    }
    return simulation;
  }

  private liquidationLineAt(seconds: number, ticks: readonly GuardTick[]): number {
    let lineY = this.liquidationBaseY;
    for (const tick of ticks) {
      if (seconds >= tick.atSeconds) {
        lineY += 12 * easeInOut(Math.min(1, (seconds - tick.atSeconds) / 0.6));
      }
    }
    return lineY;
  }

  private drawAtTime(seconds: number): void {
    const simulation = this.simulate(seconds);
    this.draw(seconds, simulation, false);
    if (this.tickerTrack !== null && !this.tickerPaused) {
      const half = this.tickerTrack.scrollWidth / 2 || 1;
      const offset = (seconds * TICKER_PIXELS_PER_SECOND) % half;
      this.tickerTrack.style.transform = `translate3d(${(-offset).toFixed(1)}px,0,0)`;
    }
  }

  private renderStill(): void {
    if (this.context === null) {
      return;
    }
    const seconds = this.frozenSeconds ?? DRAW_SECONDS;
    this.simulation = null;
    this.draw(seconds, this.simulate(seconds), this.reducedMotion);
    if (this.tickerTrack !== null && this.frozenSeconds !== null) {
      const half = this.tickerTrack.scrollWidth / 2 || 1;
      const offset = (seconds * TICKER_PIXELS_PER_SECOND) % half;
      this.tickerTrack.style.transform = `translate3d(${(-offset).toFixed(1)}px,0,0)`;
    }
  }

  private runFrame(now: number): void {
    if (this.stopped) {
      return;
    }
    this.frameRan = true;
    this.drawAtTime((now - this.startedAt) / 1000);
    this.frameHandle = requestAnimationFrame((next) => {
      this.runFrame(next);
    });
  }

  private draw(seconds: number, simulation: Simulation, still: boolean): void {
    const context = this.context;
    if (context === null) {
      return;
    }
    const width = this.width;
    const height = this.height;
    context.clearRect(0, 0, width, height);

    const pointerX = still ? 0 : this.pointerOffset.x * (this.isNarrow ? 0 : 3);
    const pointerY = still ? 0 : this.pointerOffset.y * (this.isNarrow ? 0 : 3);
    const drift = still ? 0 : seconds;
    const planes = [
      {
        colour: this.palette.accentDeeper,
        alpha: 0.07,
        top: 0.78,
        tall: 0.22,
        wide: 1.0,
        inset: 0.6,
        depth: 0.9,
      },
      {
        colour: this.palette.accentDeep,
        alpha: 0.06,
        top: 0.56,
        tall: 0.2,
        wide: 0.72,
        inset: 0.45,
        depth: 0.7,
      },
      {
        colour: this.palette.accent,
        alpha: 0.05,
        top: 0.36,
        tall: 0.18,
        wide: 0.44,
        inset: 0.3,
        depth: 0.5,
      },
    ];
    planes.forEach((plane, index) => {
      const offsetX = Math.sin(drift * 0.11 + index) * 14 + pointerX * plane.depth;
      const offsetY = Math.cos(drift * 0.09 + index * 1.7) * 8 + pointerY * plane.depth;
      const centreX = width / 2 + offsetX;
      const top = height * plane.top + offsetY;
      const bottom = top + height * plane.tall;
      const half = (width * plane.wide) / 2;
      const inset = half * plane.inset;
      context.beginPath();
      context.moveTo(centreX - half + inset, top);
      context.lineTo(centreX + half - inset, top);
      context.lineTo(centreX + half, bottom);
      context.lineTo(centreX - half, bottom);
      context.closePath();
      context.fillStyle = plane.colour;
      context.globalAlpha = plane.alpha;
      context.fill();
      context.globalAlpha = 1;
    });

    context.strokeStyle = this.palette.hairline;
    context.lineWidth = 1;
    context.font = "10px 'Geist Mono', ui-monospace, monospace";
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    let gridIndex = 0;
    for (let gridY = GRID_SPACING_PIXELS; gridY < height; gridY += GRID_SPACING_PIXELS) {
      context.beginPath();
      context.moveTo(0, gridY + 0.5);
      context.lineTo(width, gridY + 0.5);
      context.stroke();
      const label = this.labels.gridLabels[gridIndex];
      if (label !== undefined) {
        context.fillStyle = this.palette.muted;
        context.fillText(label, width - (this.isNarrow ? 12 : 44), gridY - 8);
      }
      gridIndex += 1;
    }

    const liquidationY =
      Math.round(this.liquidationLineAt(seconds, simulation.guardTicks)) + 0.5;
    context.strokeStyle = this.palette.gold;
    context.globalAlpha = 0.8;
    context.beginPath();
    context.moveTo(0, liquidationY);
    context.lineTo(width, liquidationY);
    context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = this.palette.gold;
    context.textAlign = 'left';
    context.fillText(this.labels.liquidationLabel, 12, liquidationY - 8);

    const headWorldX = this.pixelsPerSecond * seconds;
    const scrolledBy = Math.max(0, headWorldX - this.headPixels);
    const points = simulation.points;
    let first = 0;
    while (
      first < points.length - 1 &&
      (points[first]?.x ?? 0) < scrolledBy - POINT_SPACING_PIXELS * 2
    ) {
      first += 1;
    }
    const last = Math.min(
      points.length - 1,
      Math.floor(headWorldX / POINT_SPACING_PIXELS),
    );
    const head = points[last];
    if (last <= first || head === undefined) {
      return;
    }
    context.beginPath();
    for (let index = first; index <= last; index += 1) {
      const point = points[index];
      if (point === undefined) {
        continue;
      }
      if (index === first) {
        context.moveTo(point.x - scrolledBy, point.y);
      } else {
        context.lineTo(point.x - scrolledBy, point.y);
      }
    }
    context.strokeStyle = this.palette.accent;
    context.lineWidth = 1.5;
    context.lineJoin = 'round';
    context.stroke();

    const headX = head.x - scrolledBy;
    const headY = head.y;
    const glow = context.createRadialGradient(headX, headY, 0, headX, headY, 16);
    glow.addColorStop(0, withAlpha(this.palette.accent, 0.45));
    glow.addColorStop(1, withAlpha(this.palette.accent, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(headX, headY, 16, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = this.palette.accent;
    context.beginPath();
    context.arc(headX, headY, 3, 0, Math.PI * 2);
    context.fill();

    for (const tick of simulation.guardTicks) {
      if (tick.atSeconds > seconds) {
        continue;
      }
      const tickX = tick.x - scrolledBy;
      if (tickX < -10) {
        continue;
      }
      context.strokeStyle = this.palette.accent;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(tickX + 0.5, tick.y + 4);
      context.lineTo(tickX + 0.5, tick.y + 10);
      context.stroke();
      const age = seconds - tick.atSeconds;
      if (age >= GUARD_LABEL_SECONDS) {
        continue;
      }
      const fade =
        age < 0.4 ? age / 0.4 : age > 2.4 ? (GUARD_LABEL_SECONDS - age) / 0.6 : 1;
      context.globalAlpha = Math.max(0, Math.min(1, fade));
      context.fillStyle = this.palette.accent;
      context.textAlign = 'left';
      context.fillText(this.labels.guardTickLabel, headX + 14, headY + 18);
      context.globalAlpha = 1;
    }
  }
}

export interface MountedHero {
  stop: () => void;
}

export function mountHeroCanvas(
  element: HTMLElement,
  canvas: HTMLCanvasElement,
  palette: HeroPalette,
  labels: HeroLabels,
  frozenSeconds: number | null = null,
): MountedHero {
  const hero = new LivingHero(element, canvas, palette, labels, frozenSeconds);
  return {
    stop: () => {
      hero.stop();
    },
  };
}
