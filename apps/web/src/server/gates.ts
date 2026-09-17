import 'server-only';

import { eq } from 'drizzle-orm';

import {
  CURRENT_RISK_ACKNOWLEDGEMENT_VERSION,
  CURRENT_TERMS_VERSION,
  acknowledgementIsCurrent,
  termsAreCurrent,
} from '@accrue/core';
import { createDatabaseClient, schema, type AccrueDatabase } from '@accrue/db';

let database: AccrueDatabase | null = null;

function db(): AccrueDatabase {
  database ??= createDatabaseClient();
  return database;
}

export interface WalletStanding {
  readonly address: string;
  readonly termsVersion: number | null;
  readonly termsAccepted: boolean;
  readonly riskAcknowledgementVersion: number | null;
  readonly risksAcknowledged: boolean;
}

export async function standingOf(address: string): Promise<WalletStanding> {
  const [row] = await db()
    .select({
      termsVersion: schema.wallets.termsVersion,
      riskAcknowledgementVersion: schema.wallets.riskAcknowledgementVersion,
    })
    .from(schema.wallets)
    .where(eq(schema.wallets.address, address))
    .limit(1);

  const termsVersion = row?.termsVersion ?? null;
  const riskVersion = row?.riskAcknowledgementVersion ?? null;
  return {
    address,
    termsVersion,
    termsAccepted: termsAreCurrent(termsVersion),
    riskAcknowledgementVersion: riskVersion,
    risksAcknowledged: acknowledgementIsCurrent(riskVersion),
  };
}

export async function acceptTerms(address: string, version: number): Promise<boolean> {
  if (version !== CURRENT_TERMS_VERSION) {
    return false;
  }
  await db()
    .update(schema.wallets)
    .set({ termsVersion: version, termsAcceptedAt: new Date() })
    .where(eq(schema.wallets.address, address));
  await recordInTheAuditLog(address, 'terms_accepted', { version });
  return true;
}

export async function acknowledgeRisks(
  address: string,
  version: number,
): Promise<boolean> {
  if (version !== CURRENT_RISK_ACKNOWLEDGEMENT_VERSION) {
    return false;
  }
  await db()
    .update(schema.wallets)
    .set({ riskAcknowledgementVersion: version, riskAcknowledgedAt: new Date() })
    .where(eq(schema.wallets.address, address));
  await recordInTheAuditLog(address, 'risk_acknowledged', { version });
  return true;
}

type AuditAction = (typeof schema.auditLog.action)['enumValues'][number];

export async function recordInTheAuditLog(
  actor: string,
  action: AuditAction,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await db().insert(schema.auditLog).values({ actor, action, details });
  } catch {
    // The log is a record, not a gate. A position is never blocked because writing it failed.
  }
}
