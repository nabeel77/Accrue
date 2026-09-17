import 'server-only';

import { randomBytes, createHash } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { createDatabaseClient, schema, type AccrueDatabase } from '@accrue/db';

import { number, required } from './env.js';

const COOKIE = 'accrue_session';
const A_DAY_IN_MILLISECONDS = 86_400_000;
const A_MINUTE_IN_MILLISECONDS = 60_000;

let database: AccrueDatabase | null = null;

function db(): AccrueDatabase {
  database ??= createDatabaseClient();
  return database;
}

function sessionDays(): number {
  return number('SESSION_TTL_DAYS', 7);
}

function nonceMinutes(): number {
  return number('AUTH_NONCE_TTL_MINUTES', 5);
}

export function authDomain(): string {
  return required('AUTH_DOMAIN');
}

/** The exact message the wallet signs. Nothing signs anything we did not build and show. */
export function signInMessage(
  walletAddress: string,
  nonce: string,
  issuedAt: string,
): string {
  return [
    `${authDomain()} wants you to sign in with your Solana account:`,
    walletAddress,
    '',
    'Sign this message to prove the wallet is yours. It authorises nothing and moves nothing.',
    '',
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt}`,
  ].join('\n');
}

export async function issueNonce(walletAddress: string): Promise<{
  nonce: string;
  issuedAt: string;
  message: string;
}> {
  const nonce = randomBytes(24).toString('base64url');
  const issuedAt = new Date().toISOString();
  await db()
    .insert(schema.wallets)
    .values({ address: walletAddress })
    .onConflictDoUpdate({
      target: schema.wallets.address,
      set: { lastSeenAt: new Date() },
    });
  await db()
    .insert(schema.authNonces)
    .values({
      nonce,
      walletAddress,
      expiresAt: new Date(Date.now() + nonceMinutes() * A_MINUTE_IN_MILLISECONDS),
    });
  return { nonce, issuedAt, message: signInMessage(walletAddress, nonce, issuedAt) };
}

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
  const id = randomBytes(32).toString('base64url');
  await db()
    .insert(schema.sessions)
    .values({
      id,
      walletAddress,
      expiresAt: new Date(Date.now() + sessionDays() * A_DAY_IN_MILLISECONDS),
      userAgentHash:
        userAgent === null ? null : createHash('sha256').update(userAgent).digest('hex'),
    });

  const store = await cookies();
  store.set(COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: sessionDays() * 24 * 60 * 60,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const id = store.get(COOKIE)?.value;
  if (id !== undefined) {
    await db()
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.sessions.id, id));
  }
  store.delete(COOKIE);
}

/** The wallet this request belongs to, or null. Nothing takes a wallet from the caller. */
export async function walletOfTheSession(): Promise<string | null> {
  const store = await cookies();
  const id = store.get(COOKIE)?.value;
  if (id === undefined) {
    return null;
  }
  const [row] = await db()
    .select({ walletAddress: schema.sessions.walletAddress })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.id, id),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row?.walletAddress ?? null;
}
