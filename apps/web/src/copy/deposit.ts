export const DEPOSIT_COPY = {
  amountLabel: 'Dollars of',
  amountPrefix: '$',
  amountMax: 'MAX',
  amountMaxWaitingForAPrice: 'price loading',
  inYourWallet: (balance: string, stockSymbol: string): string =>
    `${balance} ${stockSymbol} in your wallet`,
  inYourWalletWorth: (balance: string, stockSymbol: string, valueUsd: string): string =>
    `${balance} ${stockSymbol} in your wallet ≈ ${valueUsd}`,
  stockColumnTitle: 'Stock',
  earnsColumnTitle: 'Earns / yr',
  balanceInYourWallet: (balance: string): string => `${balance} in your wallet`,
  stockEmpty: 'Your wallet holds none of these yet.',
  earnInColumnTitle: 'Earn in',
  earnsLine: (earnings: string, netYield: string): string =>
    `Earns ≈ ${earnings} / year · ${netYield}`,
  addsLine: (earnings: string, stockSymbol: string, netYield: string): string =>
    `Adds ≈ ${earnings} / year to your ${stockSymbol} position · ${netYield}`,
  details: 'Details',
  depositRow: 'Deposit',
  borrowedRow: 'Borrowed',
  intoRow: 'Into',
  destinationRateRow: (destinationSymbol: string): string => `${destinationSymbol} rate`,
  loanRateRow: 'Loan rate',
  netRow: 'Net',
  guardRepaysAtRow: 'Guard repays at',
  loanToValueLevel: (level: string): string => `${level} LTV`,
  liquidationRow: 'Liquidation',
  quoteRow: 'Quote',
  positionSizeRow: 'Position size',
  sizeRange: (smallest: string, largest: string): string =>
    `${smallest} to ${largest} USD`,
  oneSignatureNote:
    'One signature, your position lives in an account only you can empty.',
  guardStaysTheSame:
    'The guard keeps the levels you already chose. Change them on the position page.',
  guardRepaysAtRowForTheOpenPosition: 'Guard repays at',
  borrowMoreRow: 'Borrow more when the price rises',
  borrowMoreOn: 'on',
  borrowMoreOff: 'off',
  targetRow: 'Target',
  theseBelongToYourPosition: 'These belong to your position. Change them from its page.',
  positionName: (stockSymbol: string, destinationSymbol: string): string =>
    `${stockSymbol} → ${destinationSymbol}`,
  adjust: 'Adjust',
  deposit: 'Deposit',
  youBorrow: 'You borrow',
  youReceive: 'You receive',
  holdsAfter: 'The position holds',
  owesAfter: 'It owes',
  loanToValueAfter: 'Loan to value',
} as const;

export const EARNS_EXPLAINER_COPY = {
  title: 'Earns / yr',
  whatItIs: (stockSymbol: string, destinationSymbol: string): string =>
    `What a ${stockSymbol} deposit earns you per year after the loan cost, with ${destinationSymbol} selected.`,
  theWorking: (
    borrowShare: string,
    destinationSymbol: string,
    destinationRate: string,
    loanRate: string,
    netRate: string,
  ): string =>
    `Accrue borrows ${borrowShare} of your stock's value, ${destinationSymbol} pays ${destinationRate}, the loan costs ${loanRate}: ${borrowShare} × (${destinationRate} − ${loanRate}) = ${netRate}.`,
  notAPromise: 'Not a promise. Both rates move.',
} as const;

export const YIELD_TOKEN_DETAILS_COPY = {
  title: 'Details',
  paysAbout: (destinationSymbol: string, rateAYear: string): string =>
    `${destinationSymbol} pays about ${rateAYear} a year.`,
  whatTheIssuerAimsFor: (rateAge: string): string =>
    `That is what its issuer aims for, not a promise. It can be lower. Read ${rateAge}.`,
  whatTheIssuerAimsForUnread:
    'That is what its issuer aims for, not a promise. It can be lower.',
  sellingItBackTitle: 'Selling it back into USDC',
  sellUpTo: (
    sellableTodayUsd: string,
    destinationSymbol: string,
    mostLostToThePrice: string,
    quoteAge: string,
  ): string =>
    `Right now you can sell up to ${sellableTodayUsd} of ${destinationSymbol} for USDC and lose at most ${mostLostToThePrice} to the price. Checked ${quoteAge}.`,
  noPriceToSellAt: (destinationSymbol: string): string =>
    `Right now there is no price for selling ${destinationSymbol} back into USDC, so it is not offered.`,
  askTheIssuer: 'You can also ask the issuer to buy it back. That can take days.',
  whereTheNumbersComeFromTitle: 'Where the numbers come from',
  sources: (rateSource: string, priceSource: string): string =>
    `Rate: ${rateSource}. Price: ${priceSource}.`,
  jupiter: 'Jupiter',
  testRouter: 'the test router',
} as const;

export const ADJUST_COPY = {
  title: 'Adjust',
  resetToDefault: 'Reset to default',
  borrowLabel: 'Borrow',
  borrowNote: 'How much USDC the position borrows against your stock.',
  guardLabel: 'Guard repays at',
  guardNote:
    'The loan to value the guard acts at, always under the liquidation threshold.',
  leaveLabel: 'Leave if the market retires this stock',
  leaveNote: 'Anyone can return the position to you when the market retires the reserve.',
  detailsLabel: 'Details',
  done: 'Done',
  overridePrompt: 'Type override to continue.',
  overrideWord: 'override',
} as const;

export const QUOTE_COPY = {
  quoted: 'Quoted',
  minimum: 'You receive at least',
} as const;

export const REVIEW_COPY = {
  title: 'Deposit',
  depositing: (amountUsd: string, stockSymbol: string): string =>
    `${amountUsd} of ${stockSymbol}`,
  earns: (earnings: string, netYield: string): string =>
    `Earns ≈ ${earnings} / year · ${netYield}`,
  whatCanGoWrong: 'What this does, and what can go wrong',
  readItAgain: 'Quote again',
  sign: 'Sign',
} as const;
