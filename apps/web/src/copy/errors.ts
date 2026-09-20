import { BANNERS, REFUSALS } from './banners.js';

export const FAILURE_CODES = [
  'staleQuote',
  'simulationFailed',
  'signatureRejected',
  'rpcTimeout',
  'killSwitch',
  'programPaused',
  'rateLimited',
  'buildExpired',
  'termsBehind',
  'acknowledgementBehind',
  'staleOracle',
  'noRoute',
  'capExhausted',
  'wrongNetwork',
  'priceTooOld',
  'signInFirst',
  'faucetLimitReached',
  'signInFailed',
  'noWallet',
  'walletCannotSign',
  'notYours',
  'positionGone',
  'accountMissing',
  'notTheTransactionWeBuilt',
  'stockNotOffered',
  'pairNotOnThisNetwork',
  'aboveTheMarketMaximum',
  'positionAlreadyOpen',
  'nothingToSell',
  'notEnoughStock',
  'guardLevelsOutOfBounds',
  'noLoanToGuard',
  'positionTooSmall',
  'positionTooLarge',
  'aboveTheDefaultLoanToValue',
  'aboveTheLiquidityShare',
  'somethingWentWrong',
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

// One sentence per way a build, a signature or a send can stop, in the tone of the rest of the app.
export const FAILURE_COPY: Record<FailureCode, string> = {
  staleQuote:
    'This quote was read too long ago to sign against. We asked for a new one, so read the numbers again.',
  simulationFailed:
    'The chain refused this transaction when we tried it here, so it is never offered to sign. Nothing left your wallet.',
  signatureRejected: 'You did not sign that, so nothing was sent.',
  rpcTimeout:
    'Reading the chain took longer than we wait. Nothing was sent, and nothing changed. Try again.',
  killSwitch: BANNERS.killSwitch,
  programPaused:
    'New positions are paused on chain. Your open positions are untouched, the guard keeps running, and you can unwind at any time.',
  rateLimited: 'That is more requests than this wallet gets in a minute.',
  buildExpired:
    'This transaction was built too long ago for the chain to take it. Build it again and the numbers are read fresh.',
  termsBehind:
    'The terms have changed since you accepted them. Read them again to carry on.',
  acknowledgementBehind:
    'The risk acknowledgement has changed. Read it again before this position.',
  staleOracle:
    "The market's price for this position is older than the guard acts on. The guard waits for a newer price, and so does this.",
  noRoute:
    'Nobody is buying this yield token at this size right now, so there is no way out at a price we will accept. Repaying part of the loan makes the sale smaller, or try again later.',
  capExhausted:
    'The market has no withdrawal room left for this stock right now. An unwind fails until the window resets.',
  wrongNetwork: 'Your wallet is on another network.',
  priceTooOld: "The market's price behind these numbers is older than it should be.",
  signInFirst: 'Sign in with this wallet to see that.',
  faucetLimitReached:
    'This wallet has had its test tokens for today. The faucet opens again tomorrow.',
  signInFailed: 'That sign in did not go through. Try again.',
  noWallet: 'No wallet answered on this browser. Install one and reload.',
  walletCannotSign:
    "That wallet will not sign this. Open this page in your wallet's own browser, or use another wallet.",
  notYours: 'There is no position of yours here.',
  positionGone:
    'That position is not on the chain any more, so there is nothing here to grow, repay or close. Nothing was sent.',
  accountMissing:
    'One of the accounts this needs is not on the chain, so nothing was sent and nothing changed. Reload this screen and the numbers are read again.',
  notTheTransactionWeBuilt:
    'What came back from your wallet is not the transaction we built, so nothing was sent. Close this and build it again.',
  stockNotOffered: 'That stock is not one Accrue takes as collateral.',
  pairNotOnThisNetwork: 'That pair is not set up on the network this app is pointed at.',
  aboveTheMarketMaximum:
    'That is more than the lending market will lend against this stock.',
  positionAlreadyOpen: 'You already have a position in this pair.',
  nothingToSell: 'This position holds no yield token to sell.',
  notEnoughStock: 'Your wallet does not hold that much of this stock.',
  guardLevelsOutOfBounds: 'Those guard levels are outside the bounds the program allows.',
  noLoanToGuard: 'This position has no loan for the guard to repay.',
  positionTooSmall: 'That is under the smallest position Accrue builds.',
  positionTooLarge: 'That is over the largest position Accrue builds.',
  aboveTheDefaultLoanToValue:
    "That is above Accrue's default for this stock. Open Adjust and type override to go higher.",
  aboveTheLiquidityShare: 'That borrow is too big a share of what is left to borrow.',
  somethingWentWrong:
    'Something went wrong reading the chain. Nothing was sent. Try again.',
};

export const FAILURE_DETAILS = {
  rateLimitedRetry: (seconds: string): string => `Try again in ${seconds} seconds.`,
  switchTo: (network: string): string => `Switch it to ${network} and reload.`,
  // Slots are what the program counts, so the seconds beside them are an estimate and say so.
  priceAge: (stockSymbol: string, age: string): string =>
    `The price for ${stockSymbol} was read about ${age}.`,
  capResets: (remaining: string, stockSymbol: string, capResetsAt: string): string =>
    BANNERS.withdrawalCap(remaining, stockSymbol, capResetsAt),
} as const;

const BASIS_POINTS_IN_A_PERCENT = 100;
const USDC_DECIMALS = 6;

function whole(raw: string | number | undefined, decimals: number): string {
  const value = Number(raw ?? 0) / 10 ** decimals;
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// The refusals whose sentence is only true with the numbers behind it.
export function sentenceWithTheNumbers(
  code: FailureCode,
  detail: Record<string, string | number> | undefined,
): string | null {
  if (detail === undefined) {
    return null;
  }
  if (code === 'positionAlreadyOpen' && detail['stock'] !== undefined) {
    return `You already have a position in ${detail['stock']} earning ${detail['destination']}. Close it before opening another.`;
  }
  if (code === 'positionTooSmall' && detail['minimumUsd'] !== undefined) {
    return `The smallest position is ${detail['minimumUsd']} dollars.`;
  }
  if (code === 'positionTooLarge' && detail['maximumUsd'] !== undefined) {
    return `The largest position is ${detail['maximumUsd']} dollars.`;
  }
  if (code === 'aboveTheDefaultLoanToValue' && detail['defaultLtvBps'] !== undefined) {
    const asked = Number(detail['requestedLtvBps']) / BASIS_POINTS_IN_A_PERCENT;
    const byDefault = Number(detail['defaultLtvBps']) / BASIS_POINTS_IN_A_PERCENT;
    return `You asked to borrow ${asked} percent of the stock. Accrue's default for it is ${byDefault} percent. Open Adjust and type override to go higher.`;
  }
  if (code === 'aboveTheLiquidityShare' && detail['availableRaw'] !== undefined) {
    return REFUSALS.aboveLiquidityShare(
      `${Math.round(
        (Number(detail['requestedRaw']) / Number(detail['availableRaw'])) * 100,
      )}`,
      whole(detail['availableRaw'], USDC_DECIMALS),
      `${detail['maxSharePercent']}`,
      whole(detail['maxBorrowRaw'], USDC_DECIMALS),
    );
  }
  if (code === 'guardLevelsOutOfBounds' && detail['why'] !== undefined) {
    return `${detail['why']}`;
  }
  return null;
}

// What the server names a refusal, and the sentence the reader gets for it.
const REFUSAL_TO_FAILURE: Record<string, FailureCode> = {
  terms: 'termsBehind',
  acknowledgement: 'acknowledgementBehind',
  paused: 'killSwitch',
  programPaused: 'programPaused',
  staleQuote: 'staleQuote',
  staleOracle: 'staleOracle',
  noRoute: 'noRoute',
  capExhausted: 'capExhausted',
  simulationFailed: 'simulationFailed',
  buildExpired: 'buildExpired',
  rateLimited: 'rateLimited',
  rpcTimeout: 'rpcTimeout',
  stockNotOffered: 'stockNotOffered',
  pairNotOnThisNetwork: 'pairNotOnThisNetwork',
  aboveTheMarketMaximum: 'aboveTheMarketMaximum',
  positionAlreadyOpen: 'positionAlreadyOpen',
  nothingToSell: 'nothingToSell',
  notEnoughStock: 'notEnoughStock',
  guardLevelsOutOfBounds: 'guardLevelsOutOfBounds',
  noLoanToGuard: 'noLoanToGuard',
  positionTooSmall: 'positionTooSmall',
  positionTooLarge: 'positionTooLarge',
  aboveTheDefaultLoanToValue: 'aboveTheDefaultLoanToValue',
  aboveTheLiquidityShare: 'aboveTheLiquidityShare',
};

export function failureCodeOf(answer: {
  readonly failure?: string;
  readonly refusal?: string;
}): FailureCode | null {
  const named = answer.failure ?? answer.refusal;
  if (named === undefined) {
    return null;
  }
  return (
    REFUSAL_TO_FAILURE[named] ??
    (FAILURE_CODES.includes(named as FailureCode) ? (named as FailureCode) : null)
  );
}
