'use client';

import type { ExplainerLine } from '../components/ui/index.js';
import { EARNS_EXPLAINER_COPY } from '../copy/deposit.js';
import { percent } from './format.js';

export function earnsPerYearLines(what: {
  stockSymbol: string;
  destinationSymbol: string;
  targetLtvBps: number;
  destinationRateBps: number;
  borrowRateBps: number;
  netYieldBps: number;
}): readonly ExplainerLine[] {
  const borrowShare = percent(what.targetLtvBps, 0);
  const destinationRate = percent(what.destinationRateBps);
  const loanRate = percent(what.borrowRateBps);
  return [
    {
      lead: null,
      text: EARNS_EXPLAINER_COPY.whatItIs(what.stockSymbol, what.destinationSymbol),
    },
    {
      lead: null,
      text: EARNS_EXPLAINER_COPY.theWorking(
        borrowShare,
        what.destinationSymbol,
        destinationRate,
        loanRate,
        percent(what.netYieldBps),
      ),
    },
    { lead: null, text: EARNS_EXPLAINER_COPY.notAPromise },
  ];
}
