// Every banner is a function of the numbers, so the sentence and the figure never drift apart.
export const BANNERS = {
  caution: (fallToLiquidation: string, stockSymbol: string): string =>
    `${stockSymbol} has to fall ${fallToLiquidation} from here before the market liquidates this position. Repaying part of the loan or adding stock moves that further away.`,
  danger: (fallToLiquidation: string, stockSymbol: string, protectLtv: string): string =>
    `${stockSymbol} has to fall only ${fallToLiquidation} from here before the market liquidates this position, and it is already above its guard level of ${protectLtv}.`,
  guardActsNext:
    'The guard repays part of the loan by itself, the next time a keeper looks at this position.',
  guardRepaidAndWaits: (lastRepaid: string, until: string): string =>
    `The guard repaid ${lastRepaid} and can act again in ${until}. If the market could seize this position before then, it acts at once instead of waiting.`,
  guardHasNotActedYet: 'The guard has not repaid anything on this position yet.',
  orDoItYourself: 'You can press Protect now instead, or unwind, or add stock.',
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

export const YIELD_LINE = {
  aYear: (rate: string): string => `${rate} / yr`,
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
  youNeedAbout: (amountUsd: string): string =>
    `You need about ${amountUsd} of USDC in your wallet to close`,
  nothingNeeded:
    'Selling your yield token covers the loan in full. Nothing is needed from your wallet.',
  earnedLabel: 'Earned on this position',
  lostLabel: 'Lost on this position',
  topUpYourWallet: (amountUsd: string): string =>
    `This position needs about ${amountUsd} of USDC in your wallet to close. The loan grew past what the yield token is worth.`,
  noPriceRightNow: (destinationSymbol: string): string =>
    `Could not get a price for your ${destinationSymbol} right now`,
  tryAgain: 'Try again',
  askingForAPrice: 'Asking for a price',
} as const;

export const TEST_USDC_COPY = {
  get: 'Get test USDC',
  getting: 'Getting test USDC',
  sent: 'Test USDC sent',
  failed: 'The faucet did not answer. Try again.',
} as const;
