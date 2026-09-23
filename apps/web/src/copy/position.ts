export const POSITION_COPY = {
  summaryTitle: 'Where this position stands',
  youPutIn: 'You put in',
  youBorrowed: 'You borrowed',
  itBought: 'It bought',
  borrowedAgainst: 'Borrowed against your stock',
  earningAtNet: 'Earning, after the loan',
  ofTheStock: (stockSymbol: string): string => `of ${stockSymbol}`,
  aYear: (rate: string): string => `${rate} / yr`,
  priceNow: 'The stock now',
  priceThenAndChange: (atOpen: string, change: string): string =>
    `${atOpen} when you deposited, ${change} since`,
  loanToValueNow: (now: string, target: string): string =>
    `${now} of the stock, against a target of ${target}`,
  guardCardTitle: 'Guard',
  repaysAt: 'Repays at',
  // The guard level and where the loan to value actually is, on one line.
  repaysAtAndNow: (level: string, now: string): string => `${level} LTV · now ${now}`,
  lastChecked: 'Last checked',
  repaid: 'Repaid by the guard',
  repaidTimes: (times: string, when: string): string => `${times} times · last ${when}`,
  repaidNever: 'not yet',
  canActAgainIn: (until: string): string => `can act again in ${until}`,
  lastCheckedBy: (when: string, keeper: string): string => `${when} · ${keeper}`,
  noKeeperSeen: (minutes: string): string => `No keeper seen for ${minutes} min`,
  details: 'Details',
  change: 'Change',
  protectNow: 'Protect now',
  addCollateral: 'Add stock',
  repay: 'Repay',
  unwind: 'Unwind',
  repayAndClose: 'Repay and close',
  liquidationPrice: 'Liquidated at',
  distanceToLiquidation: 'The stock can fall',
  currentNetRate: 'Net rate now',
  closingTitle: 'This position is part way out',
  closingNote:
    'The guard sold what it could and repaid what it could. Pay the rest to finish.',
  stillOwed: 'Still owed',
  liveDebtUnavailable: 'The lending market could not be read just now.',
  finished: 'That position is closed. Everything it held is back in your wallet.',
  nothingToRepay: 'This position is under its guard level, so there is nothing to repay.',
  guardIsWaitingOutItsInterval: (until: string): string =>
    `The guard repays this position at most once a minute, so its next turn is in ${until}. You can repay it yourself now, and so can anyone once the market could seize it.`,
} as const;

export const ACTION_COPY = {
  close: 'Close',
  closing: 'Closing',
  addCollateral: 'Add stock',
  adding: 'Adding',
  repay: 'Repay',
  repaying: 'Repaying',
  changeGuard: 'Change guard',
  changing: 'Changing',
  protectNow: 'Protect now',
  protecting: 'Protecting',
  amountLabel: 'Amount',
  confirm: 'Sign',
  pending: 'Waiting for the chain',
  confirmed: 'Done',
  failed: 'The chain refused that. Nothing changed.',
  estimateUnavailable: 'No quote came back, so there is no estimate right now.',
} as const;

// What the repay and add collateral sheets say around their amount field.
export const TOP_UP_COPY = {
  title: 'Deposit more',
  note: 'More stock in, more borrowed against it at the level you already chose, and the USDC into the same yield token.',
  addCollateralInstead: 'Add stock without borrowing',
  confirm: 'Sign',
  working: 'Growing the position',
} as const;

export const AMOUNT_SHEET_COPY = {
  youCanRepay: 'You can repay',
  repayNote: (owed: string, walletHolds: string): string =>
    `You owe ${owed} USDC and your wallet holds ${walletHolds} USDC. Repaying moves the liquidation price away from today's price.`,
  addCollateralNote: (stockSymbol: string): string =>
    `More ${stockSymbol} in the position, with nothing borrowed against it, so the loan to value falls and the liquidation price moves away from today's price.`,
  nothingToRepay: 'This position owes nothing.',
  noStockToAdd: (stockSymbol: string): string =>
    `Your wallet holds no ${stockSymbol} to add.`,
} as const;

// The three rows inside the guard card's Details disclosure.
export const GUARD_PARAMETER_LABELS = {
  target: 'Target',
  guard: 'Guard',
  liquidationThreshold: 'Liquidation threshold',
} as const;

// The one switch the owner turns on deliberately, and the explainer beside it.
export const BORROW_MORE_COPY = {
  label: 'Borrow more when the price rises',
  note: 'Earns more when your stock rises, and raises your liquidation price.',
  explain: 'What this switch does',
  today: (
    tokens: string,
    stockSymbol: string,
    owed: string,
    liquidatedBelow: string,
  ): string =>
    `Today you hold ${tokens} ${stockSymbol} and owe ${owed}. You are safe down to ${liquidatedBelow}.`,
  withItOff: (
    stockSymbol: string,
    risenTo: string,
    owed: string,
    liquidatedBelow: string,
    fall: string,
  ): string =>
    `If ${stockSymbol} rises to ${risenTo} with this off, you still owe ${owed} and are safe down to ${liquidatedBelow}, a ${fall} fall.`,
  withItOn: (
    borrowedMore: string,
    destinationSymbol: string,
    earnsOn: string,
    insteadOf: string,
    liquidatedBelow: string,
    fall: string,
  ): string =>
    `With this on, the position borrows ${borrowedMore} more and puts it into ${destinationSymbol}, so it earns on ${earnsOn} instead of ${insteadOf}, and you are safe down to ${liquidatedBelow}, a ${fall} fall.`,
  theChoice: [
    { lead: 'Off:', text: 'a rising stock makes you safer.' },
    {
      lead: 'On:',
      text: 'a rising stock earns more, the safety stays where it started.',
    },
  ],
  repaysOnly: 'Repays only',
  repaysAndBorrowsMore: 'Repays and borrows more',
} as const;

export const GUARD_FIELD_COPY = {
  borrowTo: 'Borrow to',
  borrowToNote: 'How much of the stock is borrowed against.',
  guardRepaysAt: 'Guard repays at',
  guardRepaysAtNote: 'The level the guard steps in at, above where you borrow to.',
  borrowBackBelow: 'Borrow back below',
  borrowBackBelowNote: 'The level the guard borrows back to target from.',
} as const;
