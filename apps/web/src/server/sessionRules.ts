import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'accrue_session';
export const A_DAY_IN_MILLISECONDS = 86_400_000;
export const A_MINUTE_IN_MILLISECONDS = 60_000;
const SESSION_ID_BYTES = 32;
const NONCE_BYTES = 24;

// The exact message the wallet signs. The domain is in it so a copy of the app cannot reuse it.
export function signInMessage(
  domain: string,
  walletAddress: string,
  nonce: string,
  issuedAt: string,
): string {
  return [
    `${domain} wants you to sign in with your Solana account:`,
    walletAddress,
    '',
    'Sign this message to prove the wallet is yours. It authorises nothing and moves nothing.',
    '',
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt}`,
  ].join('\n');
}

export function newSessionSecret(): string {
  return randomBytes(SESSION_ID_BYTES).toString('base64url');
}

export function newNonce(): string {
  return randomBytes(NONCE_BYTES).toString('base64url');
}

// Only the hash is stored, so a stolen row cannot be turned back into a cookie.
export function fingerprintOf(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sessionExpiresAt(nowMilliseconds: number, days: number): Date {
  return new Date(nowMilliseconds + days * A_DAY_IN_MILLISECONDS);
}

export function nonceExpiresAt(nowMilliseconds: number, minutes: number): Date {
  return new Date(nowMilliseconds + minutes * A_MINUTE_IN_MILLISECONDS);
}

export interface CookieRules {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: 'strict';
  readonly path: string;
  readonly maxAge: number;
}

export function cookieRules(days: number, inProduction: boolean): CookieRules {
  return {
    httpOnly: true,
    secure: inProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: days * 24 * 60 * 60,
  };
}
