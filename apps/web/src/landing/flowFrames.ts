export interface FlowFrame {
  readonly boxStroke: string;
  readonly stockX: number;
  readonly stockY: number;
  readonly stockScale: number;
  readonly gaugeOpacity: number;
  readonly gaugeDash: string;
  readonly gaugeText: string;
  readonly loanOpacity: number;
  readonly loanWidth: number;
  readonly chartOpacity: number;
  readonly liquidationY: number;
  readonly tickOpacity: number;
  readonly counterOpacity: number;
  readonly profitOpacity: number;
  readonly profitX: number;
  readonly profitY: number;
  readonly coinOpacity: number;
  readonly coinStroke: string;
  readonly coinLabel: string;
  readonly coinOneX: number;
  readonly coinTwoX: number;
  readonly coinThreeX: number;
  readonly coinY: number;
  readonly coinThreeY: number;
  readonly coinThreeScale: number;
  readonly coinThreeOpacity: number;
}

export const FLOW_STEPS = 5;

export function frameFor(step: number): FlowFrame {
  const inBox = step >= 1;
  const back = step === 4;
  const gauge = step >= 1 && step <= 3;
  const coins = step >= 1 && step <= 3;
  const onyc = step >= 2;
  const chart = step === 3;

  const frame: FlowFrame = {
    boxStroke: inBox && !back ? '#37B98D' : '#22201D',
    stockX: back ? 24 : inBox ? 50 : 24,
    stockY: back ? 47 : step === 3 ? 33 : inBox ? 42 : 47,
    stockScale: inBox && !back ? 1.15 : 1,
    gaugeOpacity: gauge ? 1 : 0,
    gaugeDash: gauge ? (step === 3 ? '38 126' : '50 126') : '0 126',
    gaugeText: step === 3 ? '31%' : '40%',
    loanOpacity: step >= 3 ? 1 : 0,
    loanWidth: step === 4 ? 0 : step === 3 ? 112 : 150,
    chartOpacity: chart ? 1 : 0,
    liquidationY: chart ? 200 : 192,
    tickOpacity: chart ? 1 : 0,
    counterOpacity: step === 2 ? 1 : 0,
    profitOpacity: back ? 1 : 0,
    profitX: back ? 72 : 344,
    profitY: back ? 96 : 150,
    coinOpacity: coins ? 1 : 0,
    coinStroke: onyc ? '#E2B871' : '#9A938A',
    coinLabel: onyc ? 'ONyc' : 'USDC',
    coinOneX: back ? 24 : 62,
    coinTwoX: back ? 24 : 71,
    coinThreeX: back ? 24 : step === 3 ? 91 : 80,
    coinY: back ? 47 : step === 3 ? 33 : 40,
    coinThreeY: back ? 47 : step === 3 ? 28 : 40,
    coinThreeScale: step === 3 ? 0.85 : 1,
    coinThreeOpacity: coins ? (step === 3 ? 0.7 : 1) : 0,
  };

  if (step === 2) {
    return {
      ...frame,
      coinOneX: 60,
      coinTwoX: 68,
      coinThreeX: 76,
      coinY: 36,
      coinThreeY: 36,
    };
  }
  return frame;
}

export const GUARD = {
  tokens: 2,
  start: 170,
  loan: 136,
  guard: 0.45,
  target: 0.4,
  liquidation: 0.65,
  lowest: 90,
  highest: 250,
  releaseAbove: 8,
} as const;

export function theGuardPrice(): number {
  return GUARD.loan / (GUARD.tokens * GUARD.guard);
}

export function liquidationPriceFor(loan: number): number {
  return loan / (GUARD.tokens * GUARD.liquidation);
}

export function loanToValueAt(loan: number, price: number): number {
  return loan / (GUARD.tokens * price);
}

export function loanAfterTheGuardActs(): number {
  return GUARD.target * GUARD.tokens * theGuardPrice();
}

export function colourForLoanToValue(loanToValue: number): string {
  if (loanToValue < GUARD.guard) {
    return '#6FD08C';
  }
  return loanToValue < GUARD.liquidation ? '#E8B03A' : '#E2685C';
}
