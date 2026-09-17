import { createHash } from 'node:crypto';

/** Bumped when the terms change. Nobody enters the app without accepting the current one. */
export const CURRENT_TERMS_VERSION = 1;

export const TERMS_TITLE = 'Terms of use';

export const TERMS_SUMMARY: readonly string[] = [
  'Accrue is software. It holds no key over your tokens and cannot move them.',
  'You are responsible for the wallet you connect and for every transaction you sign.',
  'Nothing here is financial, legal or tax advice, and nothing here is a promise of a return.',
  'The lending market, the yield token and the swap router are other people’s programs, and Accrue cannot recover funds lost inside them.',
];

export const TERMS_ACCEPT_BUTTON = 'Accept and continue';
export const TERMS_DECLINE_BUTTON = 'Decline';

export function termsHash(): string {
  return createHash('sha256')
    .update([TERMS_TITLE, ...TERMS_SUMMARY].join('\n'))
    .digest('hex');
}

export function termsAreCurrent(version: number | null): boolean {
  return version === CURRENT_TERMS_VERSION;
}
