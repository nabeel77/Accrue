/** Every banner is a function of the numbers, so the sentence and the figure never drift apart. */
export const BANNERS = {
  caution: (distanceToLiquidation: string): string =>
    `Your position is ${distanceToLiquidation} percent from liquidation. Repaying part of the loan or adding collateral moves it away.`,
  danger: (
    distanceToLiquidation: string,
    protectLtv: string,
    lastProtectAgo: string,
  ): string =>
    `Your position is ${distanceToLiquidation} percent from liquidation and above its guard level of ${protectLtv} percent. The last guard action was ${lastProtectAgo}. Press Protect now, or unwind, or add collateral.`,
  guardWaiting: (aboveSince: string, keepersLastHour: string): string =>
    `Above the guard level for ${aboveSince} with no protect yet. ${keepersLastHour} keepers were seen in the last hour. Press Protect now to do it yourself.`,
  deleverage: (stockSymbol: string, deleverageStartsAt: string): string =>
    `The market has flagged ${stockSymbol} for deleverage. Positions in it will be reduced from ${deleverageStartsAt} with a penalty. Unwind or reduce before then to avoid it.`,
  withdrawalCap: (
    remainingWithdrawalCapacity: string,
    stockSymbol: string,
    capResetsAt: string,
  ): string =>
    `The market has ${remainingWithdrawalCapacity} ${stockSymbol} of withdrawal room left until ${capResetsAt}. An unwind bigger than that will fail until then.`,
  liquidated: (liquidatedAt: string, liquidationPrice: string): string =>
    `This position was liquidated on ${liquidatedAt} at ${liquidationPrice}. What remains is in your wallet and on the lending market under your address.`,
  killSwitch:
    'Accrue is not building positions right now. Your open positions are untouched, the guard keeps running, and you can unwind at any time.',
} as const;

export const REFUSALS = {
  aboveDefaultLoanToValue: (
    defaultLtv: string,
    stockSymbol: string,
    maxLtv: string,
    fallAtDefault: string,
    requestedLtv: string,
    fallAtRequested: string,
  ): string =>
    `We stopped at ${defaultLtv} percent loan to value, Accrue's default for ${stockSymbol}, whose maximum is ${maxLtv} percent. At ${defaultLtv} percent the stock has to fall ${fallAtDefault} percent before liquidation. At ${requestedLtv} percent it has to fall ${fallAtRequested} percent. Type override to continue.`,
  aboveLiquidityShare: (
    requestedShare: string,
    availableUsdc: string,
    maxShare: string,
    maxBorrowUsdc: string,
  ): string =>
    `This borrow would take ${requestedShare} percent of the ${availableUsdc} USDC left to borrow right now. We stop at ${maxShare} percent, ${maxBorrowUsdc} USDC, because a bigger borrow moves the rate against you and against everyone else. Try a smaller amount or come back when more is available.`,
} as const;

export const EXIT_LINE = {
  known: (sellableTodayUsd: string, slippageBps: string, quoteAge: string): string =>
    `Exit today: up to ${sellableTodayUsd} dollars within ${slippageBps} basis points, from Jupiter, ${quoteAge}. Redeeming with the issuer is by request and can take days.`,
  unknown:
    'Exit today: unknown, no quote. This destination is not offered until a quote returns.',
} as const;

export const POSITION_LABELS = {
  borrowed: (debtUsd: string, borrowRate: string): string =>
    `${debtUsd} USDC including interest so far, at ${borrowRate} percent a year, variable.`,
  earnedSoFar: (earnedUsd: string, destinationSymbol: string): string =>
    `${earnedUsd} dollars, what your ${destinationSymbol} is worth now minus what you owe. Not paid out until you unwind.`,
  price: (oraclePrice: string, priceAge: string): string =>
    `${oraclePrice}, the market's oracle price, ${priceAge}. This is the price liquidation uses.`,
} as const;

export const CLOSING_COPY = {
  shortfallSentence:
    'Closing a position may need a small amount of USDC from your wallet to cover the difference between what the yield token sells for and what is owed.',
  estimateLabel: 'Estimated from your wallet',
} as const;
