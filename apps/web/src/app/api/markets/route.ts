import { readEveryStock, readTheBorrowReserve } from '../../../server/markets.js';
import { withinTheLimit } from '../../../server/rateLimit.js';
import { ok, somethingWentWrong, tooMany } from '../../../server/respond.js';
import { walletOfTheSession } from '../../../server/session.js';

export async function GET(): Promise<Response> {
  const wallet = await walletOfTheSession();
  const limit = await withinTheLimit('read', 'markets', wallet ?? 'anonymous');
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }
  try {
    const [stocks, borrow] = await Promise.all([
      readEveryStock(),
      readTheBorrowReserve(),
    ]);
    return ok({
      readAt: new Date().toISOString(),
      borrow: {
        symbol: 'USDC',
        borrowRateBps: borrow.borrowRateBps,
        supplyRateBps: borrow.supplyRateBps,
        utilisationBps: borrow.utilisationBps,
        availableLiquidity: borrow.availableLiquidity.toString(),
        decimals: borrow.decimals,
      },
      reserves: stocks.map(({ token, reserve }) => ({
        symbol: token.symbol,
        name: token.name,
        issuer: token.issuer,
        mint: token.mint,
        reserve: token.reserve,
        maxLoanToValueBps: reserve.maxLoanToValueBps,
        liquidationThresholdBps: reserve.liquidationThresholdBps,
        borrowRateBps: reserve.borrowRateBps,
        supplyRateBps: reserve.supplyRateBps,
        oraclePriceScaled: reserve.oraclePriceScaled.toString(),
        decimals: reserve.decimals,
        availableLiquidity: reserve.availableLiquidity.toString(),
        withdrawalCap: {
          isCapped: reserve.caps.withdrawals.isCapped,
          remaining: reserve.caps.withdrawals.remaining.toString(),
          resetsAt: reserve.caps.withdrawals.windowResetsAt.toString(),
        },
        borrowCap: {
          isCapped: reserve.caps.borrows.isCapped,
          remaining: reserve.caps.borrows.remaining.toString(),
          resetsAt: reserve.caps.borrows.windowResetsAt.toString(),
        },
        deleverage: {
          isObsolete: reserve.deleverage.isObsolete,
          autodeleverageEnabled: reserve.deleverage.autodeleverageEnabled,
          depositLimitCrossedAt: reserve.deleverage.depositLimitCrossedAt.toString(),
          borrowLimitCrossedAt: reserve.deleverage.borrowLimitCrossedAt.toString(),
          marginCallPeriodSeconds: reserve.deleverage.marginCallPeriodSeconds.toString(),
        },
      })),
    });
  } catch (failure) {
    return somethingWentWrong(failure);
  }
}
