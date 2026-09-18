import { describe, expect, it } from 'vitest';

import {
  A_DAY_IN_MILLISECONDS,
  cookieRules,
  fingerprintOf,
  newNonce,
  newSessionSecret,
  nonceExpiresAt,
  sessionExpiresAt,
  signInMessage,
  SESSION_COOKIE,
} from './sessionRules.js';

const DOMAIN = 'accrue.app';
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const NONCE = 'a-nonce-from-the-server';
const ISSUED_AT = '2026-09-17T12:00:00.000Z';
const NOW = 1_800_000_000_000;

describe('the message a wallet signs', () => {
  const message = signInMessage(DOMAIN, WALLET, NONCE, ISSUED_AT);

  it('names the domain first, so a copy of the app cannot pass its message off as ours', () => {
    expect(message.startsWith(`${DOMAIN} wants you to sign in`)).toBe(true);
  });

  it('names the wallet, the nonce and the time it was issued', () => {
    expect(message).toContain(WALLET);
    expect(message).toContain(`Nonce: ${NONCE}`);
    expect(message).toContain(`Issued at: ${ISSUED_AT}`);
  });

  it('says what signing it does not do', () => {
    expect(message).toContain('It authorises nothing and moves nothing.');
  });

  it('changes when the domain changes, so one domain cannot replay another', () => {
    expect(signInMessage('evil.example', WALLET, NONCE, ISSUED_AT)).not.toBe(message);
  });
});

describe('the session secret', () => {
  it('is different every time', () => {
    expect(newSessionSecret()).not.toBe(newSessionSecret());
  });

  it('is long enough that guessing it is not a plan', () => {
    expect(newSessionSecret().length).toBeGreaterThanOrEqual(43);
  });

  it('is stored only as a hash, which the secret cannot be read back from', () => {
    const secret = newSessionSecret();
    const stored = fingerprintOf(secret);
    expect(stored).not.toBe(secret);
    expect(stored).toHaveLength(64);
    expect(stored).toMatch(/^[0-9a-f]+$/u);
  });

  it('hashes the same secret to the same row, and another secret to another row', () => {
    expect(fingerprintOf('one')).toBe(fingerprintOf('one'));
    expect(fingerprintOf('one')).not.toBe(fingerprintOf('two'));
  });
});

describe('the nonce', () => {
  it('is different every time', () => {
    expect(newNonce()).not.toBe(newNonce());
  });

  it('dies the number of minutes after it was issued that the environment says', () => {
    expect(nonceExpiresAt(NOW, 5).getTime()).toBe(NOW + 300_000);
  });
});

describe('the cookie', () => {
  it('has one name', () => {
    expect(SESSION_COOKIE).toBe('accrue_session');
  });

  it('is not readable by a script, not sent across sites, and lives for the whole session', () => {
    const rules = cookieRules(7, true);
    expect(rules.httpOnly).toBe(true);
    expect(rules.sameSite).toBe('strict');
    expect(rules.path).toBe('/');
    expect(rules.maxAge).toBe(7 * 24 * 60 * 60);
  });

  it('is secure in production and plain in development, where there is no https', () => {
    expect(cookieRules(7, true).secure).toBe(true);
    expect(cookieRules(7, false).secure).toBe(false);
  });

  it('expires the row at the same time it tells the browser to forget the cookie', () => {
    const days = 7;
    expect(sessionExpiresAt(NOW, days).getTime()).toBe(
      NOW + days * A_DAY_IN_MILLISECONDS,
    );
    expect(cookieRules(days, true).maxAge * 1_000).toBe(days * A_DAY_IN_MILLISECONDS);
  });
});
