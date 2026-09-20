const JADE = '#37B98D';
const GOLD = '#E2B871';
const HAIRLINE = '#22201D';

const ROW_HEIGHT = 80;
const STEP_X = 9;
const DRIFT_PER_SECOND = 12;
const GOLD_AT = 0.8;
const A_SECOND = 1_000;

function randomFrom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

export class PaintTheLedger {
  private readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null = null;
  private readonly reduced: boolean;
  private width = 0;
  private height = 0;
  private points: readonly (readonly [number, number])[] = [];
  private readonly startedAt = performance.now();
  private dead = false;
  private observer: ResizeObserver | null = null;

  constructor(element: HTMLElement, canvas: HTMLCanvasElement) {
    this.element = element;
    this.canvas = canvas;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => {
        this.resize();
        this.draw(0);
      });
      this.observer.observe(element);
    }
    this.draw(0);
    if (!this.reduced) {
      requestAnimationFrame(this.tick);
    }
  }

  stop(): void {
    this.dead = true;
    this.observer?.disconnect();
  }

  private readonly tick = (now: number): void => {
    if (this.dead) {
      return;
    }
    this.draw((now - this.startedAt) / A_SECOND);
    requestAnimationFrame(this.tick);
  };

  private resize(): void {
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.width = width;
    this.height = height;
    this.canvas.width = width * ratio;
    this.canvas.height = height * ratio;
    const context = this.canvas.getContext('2d');
    if (context === null) {
      return;
    }
    this.context = context;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const roll = randomFrom(11);
    const walked: [number, number][] = [];
    let lineY = height * 0.62;
    for (let lineX = -width * 0.2; lineX <= width * 1.4; lineX += STEP_X) {
      lineY += (roll() - 0.535) * 16;
      lineY = Math.max(height * 0.28, Math.min(height * 0.86, lineY));
      walked.push([lineX, lineY]);
    }
    this.points = walked;
  }

  private draw(seconds: number): void {
    const context = this.context;
    const width = this.width;
    const height = this.height;
    if (context === null || width === 0 || height === 0) {
      return;
    }
    context.clearRect(0, 0, width, height);

    context.strokeStyle = HAIRLINE;
    context.lineWidth = 1;
    context.globalAlpha = 0.55;
    for (let rowY = ROW_HEIGHT; rowY < height; rowY += ROW_HEIGHT) {
      context.beginPath();
      context.moveTo(0, rowY + 0.5);
      context.lineTo(width, rowY + 0.5);
      context.stroke();
    }
    context.globalAlpha = 1;

    const goldY = height * GOLD_AT;
    context.strokeStyle = GOLD;
    context.globalAlpha = 0.32;
    context.setLineDash([3, 6]);
    context.beginPath();
    context.moveTo(0, goldY + 0.5);
    context.lineTo(width, goldY + 0.5);
    context.stroke();
    context.setLineDash([]);

    const shift = (seconds * DRIFT_PER_SECOND) % (width * 0.2);
    context.globalAlpha = 0.3;
    context.strokeStyle = JADE;
    context.lineWidth = 1.5;
    context.lineJoin = 'round';
    context.beginPath();
    this.points.forEach(([pointX, pointY], index) => {
      if (index === 0) {
        context.moveTo(pointX - shift, pointY);
        return;
      }
      context.lineTo(pointX - shift, pointY);
    });
    context.stroke();
    context.globalAlpha = 0.08;
    context.lineWidth = 10;
    context.stroke();
    context.globalAlpha = 1;
  }
}
