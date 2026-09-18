'use client';

import { whatBorrowingMoreWouldDo } from '@accrue/core/borrow-more';

import type { ExplainerLine } from '../components/ui/index.js';
import { BORROW_MORE_COPY } from '../copy/position.js';
import { money, percent } from './format.js';

function prose(text: string): ExplainerLine {
  return { lead: null, text };
}

export function borrowMoreLines(what: {
  tokens: number;
  priceNow: number;
  debtNow: number;
  targetLtvBps: number;
  liquidationThresholdBps: number;
  stockSymbol: string;
  destinationSymbol: string;
}): readonly ExplainerLine[] {
  const shown = whatBorrowingMoreWouldDo(
    what.tokens,
    what.priceNow,
    what.debtNow,
    what.targetLtvBps,
    what.liquidationThresholdBps,
  );
  if (shown === null) {
    return BORROW_MORE_COPY.theChoice;
  }
  return [
    prose(
      BORROW_MORE_COPY.today(
        money(shown.tokens, 4),
        what.stockSymbol,
        `$${money(shown.debtNow)}`,
        `$${money(shown.liquidatedBelowNow)}`,
      ),
    ),
    prose(
      BORROW_MORE_COPY.withItOff(
        what.stockSymbol,
        `$${money(shown.risenTo)}`,
        `$${money(shown.debtWithItOff)}`,
        `$${money(shown.liquidatedBelowWithItOff)}`,
        percent(shown.fallWithItOffBps, 0),
      ),
    ),
    prose(
      BORROW_MORE_COPY.withItOn(
        `$${money(shown.borrowedMore)}`,
        what.destinationSymbol,
        `$${money(shown.debtWithItOn)}`,
        `$${money(shown.debtNow)}`,
        `$${money(shown.liquidatedBelowWithItOn)}`,
        percent(shown.fallWithItOnBps, 0),
      ),
    ),
    ...BORROW_MORE_COPY.theChoice,
  ];
}
