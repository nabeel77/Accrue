import { SCALED_FRACTION_ONE } from '../money.js';

const CENTS_IN_A_DOLLAR = 100;

export interface AStockInTheWallet {
  readonly balanceRaw: string | null;
  readonly decimals: number;
  readonly oraclePriceScaled: string;
}

export function wholeBalanceOfAStock(stock: AStockInTheWallet): number {
  if (stock.balanceRaw === null) {
    return 0;
  }
  return Number(BigInt(stock.balanceRaw)) / 10 ** stock.decimals;
}

export function priceOfAStockInDollars(stock: AStockInTheWallet): number {
  return Number(BigInt(stock.oraclePriceScaled)) / Number(SCALED_FRACTION_ONE);
}

export function aPriceHasArrivedFor(stock: AStockInTheWallet | null): boolean {
  return stock !== null && priceOfAStockInDollars(stock) > 0;
}

export function walletValueInDollars(stock: AStockInTheWallet | null): number {
  if (stock === null) {
    return 0;
  }
  return wholeBalanceOfAStock(stock) * priceOfAStockInDollars(stock);
}

export function theMostThatCanBeDeposited(
  stock: AStockInTheWallet | null,
  largestPositionUsd: number | null,
): number {
  const value = walletValueInDollars(stock);
  return largestPositionUsd === null ? value : Math.min(value, largestPositionUsd);
}

export function whatTheMaxButtonFills(
  stock: AStockInTheWallet | null,
  largestPositionUsd: number | null,
): string {
  const most = theMostThatCanBeDeposited(stock, largestPositionUsd);
  return (Math.floor(most * CENTS_IN_A_DOLLAR) / CENTS_IN_A_DOLLAR).toFixed(2);
}
