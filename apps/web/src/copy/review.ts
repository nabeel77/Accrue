// The seven lines, in this order, filled from the server response and nowhere else.
export interface ReviewValues {
  readonly collateralAmount: string;
  readonly stockSymbol: string;
  readonly collateralUsd: string;
  readonly borrowUsdc: string;
  readonly borrowRate: string;
  readonly borrowCostYear: string;
  readonly minimumDestinationAmount: string;
  readonly destinationSymbol: string;
  readonly quotedDestinationAmount: string;
  readonly destinationYield: string;
  readonly liquidationPrice: string;
  readonly fallToLiquidation: string;
  readonly currentPrice: string;
  readonly guardPrice: string;
  readonly fallToGuard: string;
  readonly protectAmount: string;
  readonly distanceAfterStress: string;
  readonly sellableTodayUsd: string;
  readonly slippagePercent: string;
  readonly quoteAge: string;
  readonly netYear: string;
  readonly netPercent: string;
}

export function reviewLines(values: ReviewValues): readonly string[] {
  return [
    `You deposit ${values.collateralAmount} ${values.stockSymbol} worth $${values.collateralUsd} as collateral.`,
    `You borrow ${values.borrowUsdc} USDC at ${values.borrowRate}% a year, variable, about $${values.borrowCostYear} a year at today's rate.`,
    `You receive at least ${values.minimumDestinationAmount} ${values.destinationSymbol}, quoted ${values.quotedDestinationAmount}, target yield ${values.destinationYield}%, not guaranteed.`,
    `Liquidated at $${values.liquidationPrice} per ${values.stockSymbol}, a ${values.fallToLiquidation}% fall from $${values.currentPrice}. The guard repays at $${values.guardPrice}, a ${values.fallToGuard}% fall.`,
    `If ${values.stockSymbol} falls 20% tonight, the guard repays $${values.protectAmount} and you are ${values.distanceAfterStress}% from liquidation.`,
    `Exit today: you could sell up to $${values.sellableTodayUsd} of ${values.destinationSymbol} and lose at most ${values.slippagePercent}% to the price. Checked ${values.quoteAge}.`,
    `If both rates hold for a year you keep about $${values.netYear}, ${values.netPercent}% on top of holding the stock. They will not hold.`,
  ];
}

export function overrideLine(ltv: string, defaultLtv: string): string {
  return `You chose ${ltv}% loan to value, above the ${defaultLtv}% default.`;
}
