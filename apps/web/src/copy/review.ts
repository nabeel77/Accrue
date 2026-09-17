/** The seven lines, in this order, filled from the server response and nowhere else. */
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
  readonly slippageBps: string;
  readonly quoteAge: string;
  readonly netYear: string;
  readonly netPercent: string;
}

export function reviewLines(values: ReviewValues): readonly string[] {
  return [
    `You deposit ${values.collateralAmount} ${values.stockSymbol} worth ${values.collateralUsd} dollars as collateral.`,
    `You borrow ${values.borrowUsdc} USDC at ${values.borrowRate} percent a year, variable, about ${values.borrowCostYear} dollars a year at today's rate.`,
    `You receive at least ${values.minimumDestinationAmount} ${values.destinationSymbol}, quoted ${values.quotedDestinationAmount}, target yield ${values.destinationYield} percent, not guaranteed.`,
    `Liquidated at ${values.liquidationPrice} dollars per ${values.stockSymbol}, a ${values.fallToLiquidation} percent fall from ${values.currentPrice}. The guard repays at ${values.guardPrice}, a ${values.fallToGuard} percent fall.`,
    `If ${values.stockSymbol} falls 20 percent tonight, the guard repays ${values.protectAmount} dollars and you are ${values.distanceAfterStress} percent from liquidation.`,
    `Exit today: up to ${values.sellableTodayUsd} dollars within ${values.slippageBps} basis points, from Jupiter, ${values.quoteAge}.`,
    `If both rates hold for a year you keep about ${values.netYear} dollars, ${values.netPercent} percent on top of holding the stock. They will not hold.`,
  ];
}

export function overrideLine(ltv: string, defaultLtv: string): string {
  return `You chose ${ltv} percent loan to value, above the ${defaultLtv} percent default.`;
}
