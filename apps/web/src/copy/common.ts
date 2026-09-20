export const NAV = {
  deposit: 'Deposit',
  portfolio: 'Portfolio',
  activity: 'Activity',
  about: 'About',
} as const;

// A guard or liquidation line in both its units, the fall in the stock first because that is the
// one a reader can picture, the loan to value after it.
export const A_LINE_IN_BOTH_UNITS = (
  stockSymbol: string,
  fall: string,
  level: string,
): string => `${stockSymbol} −${fall} · ${level} LTV`;

export const COMMON = {
  connectWallet: 'Connect wallet',
  signIn: 'Sign in',
  signOut: 'Sign out',
  signingIn: 'Signing in',
  signMessagePrompt: 'Sign one message to prove this wallet is yours.',
  missingValue: '—',
  tryAgain: 'Try again',
  close: 'Close',
  done: 'Done',
  cancel: 'Cancel',
  oneSignature: '1 signature',
  checkTheTransaction: 'Check this transaction on solscan.io',
} as const;

export const DEVNET = {
  banner: 'This is devnet. The tokens here are test tokens and have no value.',
  getTestTokens: 'Get test tokens',
  gettingTestTokens: 'Sending test tokens',
  testTokensSent: (whatWasSent: string): string => `${whatWasSent} are in your wallet.`,
  testTokensSentNothingNamed: 'Test tokens are in your wallet.',
  andSomeSol: (sol: string): string => `${sol} SOL`,
  testTokensFailed: 'The faucet could not send tokens right now.',
  moveTheMarket: 'Devnet only: move the market',
  dropTheStock: (stockSymbol: string): string => `${stockSymbol} −25%`,
  liftTheStock: (stockSymbol: string): string => `${stockSymbol} +25%`,
  resetPrices: 'Reset prices',
  movingTheMarket: 'Moving',
  marketMoveFailed: 'The price service could not move the market right now.',
  marketMoved: (stockSymbol: string, from: string, to: string): string =>
    `${stockSymbol} written at ${to}, from ${from}.`,
  waitingForTheGuard: 'Waiting for the guard to act on the new price.',
  theGuardActed: (what: string, when: string): string => `${what}, ${when}.`,
  noGuardYet: 'The guard has not acted yet. It may be inside its own interval.',
} as const;

export const AMOUNT_FIELD_COPY = {
  max: 'MAX',
  half: 'HALF',
  inYourWallet: 'In your wallet',
  owedNow: 'Owed now',
  moreThanYouHave: (available: string, symbol: string): string =>
    `That is more than the ${available} ${symbol} this can use.`,
} as const;

export const WALLETS = {
  title: 'Choose a wallet',
  none: 'No wallet answered on this browser. Install one and reload.',
  onAPhone:
    "On a phone, open this page in your wallet app's browser, or install a wallet that answers here.",
  connecting: 'Connecting',
  signing: 'Approve the message in your wallet',
} as const;
