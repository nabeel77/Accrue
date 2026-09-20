const JADE = '#37B98D';
const JADE_DEEP = '#2E8F6E';
const JADE_DEEPER = '#26654F';
const GOLD = '#E2B871';
const HAIRLINE = '#22201D';
const MUTED = '#6E675F';

const DRAW_SECONDS = 12;
const DIP_EVERY = 20;
const DIP_LENGTH = 2;
const STEP_X = 2;
const GRID_LABELS = ['176.00', '160.00', '144.00', '128.00'];
const LIQUIDATION_LABEL = 'liquidation 117.33';
const REPAID_LABEL = 'guard repaid $80';

function easeInOut(fraction: number): number {
  return fraction < 0.5
    ? 2 * fraction * fraction
    : 1 - Math.pow(-2 * fraction + 2, 2) / 2;
}

function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface APoint {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

interface AFire {
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

interface Simulation {
  pts: APoint[];
  rand: () => number;
  y: number;
  fires: AFire[];
  k: number;
  firedThis: boolean;
}

export class HeroCanvas {
  private readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null = null;
  private readonly reduced: boolean;
  private readonly mouse = { x: 0, y: 0 };
  private width = 0;
  private height = 0;
  private narrow = false;
  private headX = 0;
  private speed = 1;
  private goldBase = 0;
  private simulation: Simulation | null = null;
  private startedAt = 0;
  private dead = false;
  private observer: ResizeObserver | null = null;
  private readonly onMouseMove: (event: MouseEvent) => void;

  constructor(element: HTMLElement, canvas: HTMLCanvasElement) {
    this.element = element;
    this.canvas = canvas;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();

    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => {
        this.resize();
        this.renderStill();
      });
      this.observer.observe(element);
    }

    this.onMouseMove = (event: MouseEvent): void => {
      const box = this.element.getBoundingClientRect();
      this.mouse.x = ((event.clientX - box.left) / Math.max(1, box.width) - 0.5) * 2;
      this.mouse.y = ((event.clientY - box.top) / Math.max(1, box.height) - 0.5) * 2;
    };

    if (this.reduced) {
      this.renderStill();
      return;
    }
    if (!this.narrow) {
      window.addEventListener('mousemove', this.onMouseMove, { passive: true });
    }
    this.startedAt = performance.now();
    requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.dead = true;
    this.observer?.disconnect();
    window.removeEventListener('mousemove', this.onMouseMove);
  }

  private readonly tick = (now: number): void => {
    if (this.dead) {
      return;
    }
    this.frame((now - this.startedAt) / 1_000);
    requestAnimationFrame(this.tick);
  };

  private resize(): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(this.element.clientWidth);
    const height = Math.round(this.element.clientHeight);
    if (width === 0 || height === 0) {
      return;
    }
    this.width = width;
    this.height = height;
    this.narrow = width < 780;
    this.canvas.width = width * ratio;
    this.canvas.height = height * ratio;
    const context = this.canvas.getContext('2d');
    if (context === null) {
      return;
    }
    this.context = context;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.headX = (width * 2) / 3;
    this.speed = this.headX / DRAW_SECONDS;
    this.goldBase = height * 0.6;
    this.simulation = null;
  }

  private goldAt(seconds: number, fires: readonly AFire[]): number {
    let where = this.goldBase;
    for (const fire of fires) {
      if (seconds >= fire.t) {
        where += 12 * easeInOut(Math.min(1, (seconds - fire.t) / 0.6));
      }
    }
    return where;
  }

  private simulate(until: number): Simulation {
    const height = this.height;
    this.simulation ??= {
      pts: [],
      rand: randomFrom(20260915),
      y: height * 0.42,
      fires: [],
      k: -1,
      firedThis: false,
    };
    const state = this.simulation;
    const needed = Math.floor((this.speed * until) / STEP_X);
    while (state.pts.length <= needed) {
      const index = state.pts.length;
      const pointX = index * STEP_X;
      const at = pointX / this.speed;
      const noise = (state.rand() + state.rand() - 1) * 1.6;
      let moveY = noise - 0.045;
      const dipNumber = Math.floor((at - DIP_EVERY) / DIP_EVERY);
      const inDip =
        at >= DIP_EVERY && at - (DIP_EVERY + dipNumber * DIP_EVERY) < DIP_LENGTH;
      const goldY = this.goldAt(at, state.fires);
      if (inDip) {
        if (dipNumber !== state.k) {
          state.k = dipNumber;
          state.firedThis = false;
        }
        moveY += (goldY - state.y) * 0.035 + 0.6;
        if (!state.firedThis && Math.abs(state.y - goldY) < 0.15 * height) {
          state.firedThis = true;
          state.fires.push({ t: at, x: pointX, y: state.y });
        }
      } else {
        moveY += (height * 0.42 - state.y) * 0.004;
      }
      state.y += moveY;
      if (state.y < height * 0.2) {
        state.y = height * 0.2 + (height * 0.2 - state.y) * 0.5;
      }
      if (state.y > height * 0.82) {
        state.y = height * 0.82 - (state.y - height * 0.82) * 0.5;
      }
      state.pts.push({ x: pointX, y: state.y, t: at });
    }
    return state;
  }

  private frame(seconds: number): void {
    this.draw(seconds, this.simulate(seconds), false);
  }

  private renderStill(): void {
    if (this.context === null) {
      return;
    }
    this.simulation = null;
    this.draw(DRAW_SECONDS, this.simulate(DRAW_SECONDS), true);
  }

  private draw(seconds: number, state: Simulation, still: boolean): void {
    const context = this.context;
    const width = this.width;
    const height = this.height;
    if (context === null || width === 0 || height === 0) {
      return;
    }
    context.clearRect(0, 0, width, height);

    const pullX = still ? 0 : this.mouse.x * (this.narrow ? 0 : 3);
    const pullY = still ? 0 : this.mouse.y * (this.narrow ? 0 : 3);
    const drift = still ? 0 : seconds;
    const planes = [
      { colour: JADE_DEEPER, alpha: 0.07, y: 0.78, h: 0.22, w: 1, inset: 0.6, pull: 0.9 },
      {
        colour: JADE_DEEP,
        alpha: 0.06,
        y: 0.56,
        h: 0.2,
        w: 0.72,
        inset: 0.45,
        pull: 0.7,
      },
      { colour: JADE, alpha: 0.05, y: 0.36, h: 0.18, w: 0.44, inset: 0.3, pull: 0.5 },
    ];
    planes.forEach((plane, index) => {
      const offsetX = Math.sin(drift * 0.11 + index) * 14 + pullX * plane.pull;
      const offsetY = Math.cos(drift * 0.09 + index * 1.7) * 8 + pullY * plane.pull;
      const centreX = width / 2 + offsetX;
      const top = height * plane.y + offsetY;
      const bottom = top + height * plane.h;
      const half = (width * plane.w) / 2;
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

    context.strokeStyle = HAIRLINE;
    context.lineWidth = 1;
    context.font = "10px 'Geist Mono', ui-monospace, monospace";
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    for (let rowY = 80, row = 0; rowY < height; rowY += 80, row += 1) {
      context.beginPath();
      context.moveTo(0, rowY + 0.5);
      context.lineTo(width, rowY + 0.5);
      context.stroke();
      const label = GRID_LABELS[row];
      if (label !== undefined) {
        context.fillStyle = MUTED;
        context.fillText(label, width - (this.narrow ? 12 : 44), rowY - 8);
      }
    }

    const goldY = Math.round(this.goldAt(seconds, state.fires)) + 0.5;
    context.strokeStyle = GOLD;
    context.globalAlpha = 0.8;
    context.beginPath();
    context.moveTo(0, goldY);
    context.lineTo(width, goldY);
    context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = GOLD;
    context.textAlign = 'left';
    context.fillText(LIQUIDATION_LABEL, 12, goldY - 8);

    const headWorldX = this.speed * seconds;
    const offset = Math.max(0, headWorldX - this.headX);
    const points = state.pts;
    let start = 0;
    while (start < points.length - 1 && (points[start]?.x ?? 0) < offset - STEP_X * 2) {
      start += 1;
    }
    const last = Math.min(points.length - 1, Math.floor(headWorldX / STEP_X));
    if (last <= start) {
      return;
    }
    context.beginPath();
    for (let index = start; index <= last; index += 1) {
      const point = points[index];
      if (point === undefined) {
        continue;
      }
      if (index === start) {
        context.moveTo(point.x - offset, point.y);
      } else {
        context.lineTo(point.x - offset, point.y);
      }
    }
    context.strokeStyle = JADE;
    context.lineWidth = 1.5;
    context.lineJoin = 'round';
    context.stroke();

    const head = points[last];
    if (head === undefined) {
      return;
    }
    const headX = head.x - offset;
    const headY = head.y;
    const glow = context.createRadialGradient(headX, headY, 0, headX, headY, 16);
    glow.addColorStop(0, 'rgba(55,185,141,0.45)');
    glow.addColorStop(1, 'rgba(55,185,141,0)');
    context.fillStyle = glow;
    context.beginPath();
    context.arc(headX, headY, 16, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = JADE;
    context.beginPath();
    context.arc(headX, headY, 3, 0, Math.PI * 2);
    context.fill();

    for (const fire of state.fires) {
      if (fire.t > seconds) {
        continue;
      }
      const fireX = fire.x - offset;
      if (fireX < -10) {
        continue;
      }
      context.strokeStyle = JADE;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(fireX + 0.5, fire.y + 4);
      context.lineTo(fireX + 0.5, fire.y + 10);
      context.stroke();
      const age = seconds - fire.t;
      if (age < 3) {
        const alpha = age < 0.4 ? age / 0.4 : age > 2.4 ? (3 - age) / 0.6 : 1;
        context.globalAlpha = Math.max(0, Math.min(1, alpha));
        context.fillStyle = JADE;
        context.textAlign = 'left';
        context.fillText(REPAID_LABEL, headX + 14, headY + 18);
        context.globalAlpha = 1;
      }
    }
  }
}
