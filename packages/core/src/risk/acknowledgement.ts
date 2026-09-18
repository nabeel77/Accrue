import { createHash } from 'node:crypto';

// Bumped only when a sentence below changes.
export const CURRENT_RISK_ACKNOWLEDGEMENT_VERSION = 1;

export const RISK_ACKNOWLEDGEMENT_TITLE = 'Before your first position';

export const RISK_ACKNOWLEDGEMENT_SENTENCES: readonly string[] = [
  'My stock tokens go into an account that only I can empty, as collateral in a lending market. Nobody at Accrue can move them, and I can take everything back at any time.',
  'If the stock falls to the liquidation price shown, the market sells part or all of my tokens to repay the loan and charges a penalty. I can lose a large part of what I put in.',
  'The yield token is not a savings account. Its yield is a target that can fall, its price can fall, and selling it can take time while the loan keeps costing money.',
  'The guard repays part of my loan when the stock falls, but it can be too slow or blocked by a missing route or a stale price, so I can still be liquidated. Rates float, the market’s oracle price is what counts, and the code can have bugs.',
];

export const RISK_ACKNOWLEDGEMENT_BUTTON = 'I understand these risks';

export const RISK_ACKNOWLEDGEMENT_FOOTNOTE =
  'Version 1. You will see this again only if the words change.';

// What the version above is a version of: the title and the four sentences, in order.
export function riskAcknowledgementHash(): string {
  return createHash('sha256')
    .update([RISK_ACKNOWLEDGEMENT_TITLE, ...RISK_ACKNOWLEDGEMENT_SENTENCES].join('\n'))
    .digest('hex');
}

// Recorded beside the version.
export const RISK_ACKNOWLEDGEMENT_HASH =
  'e9d11639586e94677e8a80e7f3102a45c4d4d698d4baf9290c840e7f3319f0d2';

export function acknowledgementIsCurrent(version: number | null): boolean {
  return version === CURRENT_RISK_ACKNOWLEDGEMENT_VERSION;
}
