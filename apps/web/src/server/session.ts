import 'server-only';

import { and, eq, gt, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { schema } from '@accrue/db';

import { db } from './database.js';

import { number, required } from './env.js';
import {
  cookieRules,
  fingerprintOf,
  newNonce,
  newSessionSecret,
  nonceExpiresAt,
  sessionExpiresAt,
  signInMessage as messageFor,
  SESSION_COOKIE,
} from './sessionRules.js';

function sessionDays(): number {
  return number('SESSION_TTL_DAYS', 7);
}

function nonceMinutes(): number {
  return number('AUTH_NONCE_TTL_MINUTES', 5);
}

export function authDomain(): string {
  return required('AUTH_DOMAIN');
}

export function signInMessage(
  walletAddress: string,
  nonce: string,
  issuedAt: string,
): string {
  return messageFor(authDomain(), walletAddress, nonce, issuedAt);
}

export async function issueNonce(walletAddress: string): Promise<{
  nonce: string;
  issuedAt: string;
  message: string;
}> {
  const nonce = newNonce();
  const issuedAt = new Date().toISOString();
  await db()
    .insert(schema.authNonces)
    .values({
      nonce,
      walletAddress,
      expiresAt: nonceExpiresAt(Date.now(), nonceMinutes()),
    });
  return { nonce, issuedAt, message: signInMessage(walletAddress, nonce, issuedAt) };
}

// One use, one wallet, before it expires. The row is the gate, not anything the caller sent.
export async function spendNonce(walletAddress: string, nonce: string): Promise<boolean> {
  const [row] = await db()
    .update(schema.authNonces)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.authNonces.nonce, nonce),
        eq(schema.authNonces.walletAddress, walletAddress),
        isNull(schema.authNonces.usedAt),
        gt(schema.authNonces.expiresAt, new Date()),
      ),
    )
    .returning({ nonce: schema.authNonces.nonce });
  return row !== undefined;
}

export async function startSession(
  walletAddress: string,
  userAgent: string | null,
): Promise<void> {
  const secret = newSessionSecret();
  await db()
    .insert(schema.wallets)
    .values({ address: walletAddress })
    .onConflictDoUpdate({
      target: schema.wallets.address,
      set: { lastSeenAt: new Date() },
    });
  await db()
    .insert(schema.sessions)
    .values({
      id: fingerprintOf(secret),
      walletAddress,
      expiresAt: sessionExpiresAt(Date.now(), sessionDays()),
      userAgentHash: userAgent === null ? null : fingerprintOf(userAgent),
    });

  const store = await cookies();
  store.set(
    SESSION_COOKIE,
    secret,
    cookieRules(sessionDays(), process.env.NODE_ENV === 'production'),
  );
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const secret = store.get(SESSION_COOKIE)?.value;
  if (secret !== undefined) {
    await db()
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.sessions.id, fingerprintOf(secret)));
  }
  store.delete(SESSION_COOKIE);
}

// The wallet this request belongs to, or null.
export async function walletOfTheSession(): Promise<string | null> {
  const store = await cookies();
  const secret = store.get(SESSION_COOKIE)?.value;
  if (secret === undefined) {
    return null;
  }
  const [row] = await db()
    .select({ walletAddress: schema.sessions.walletAddress })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.id, fingerprintOf(secret)),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row?.walletAddress ?? null;
}
