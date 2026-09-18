import { eq } from 'drizzle-orm';

import { createDatabaseClient, schema } from '@accrue/db';

// The harness puts a wallet's standing back on purpose, which is what a version bump looks like.
export async function setTheStoredVersions(
  wallet: string,
  versions: { terms?: number | null; acknowledgement?: number | null },
): Promise<void> {
  const database = createDatabaseClient();
  const changes: Record<string, number | null> = {};
  if (versions.terms !== undefined) {
    changes['termsVersion'] = versions.terms;
  }
  if (versions.acknowledgement !== undefined) {
    changes['riskAcknowledgementVersion'] = versions.acknowledgement;
  }
  await database
    .update(schema.wallets)
    .set(changes)
    .where(eq(schema.wallets.address, wallet));
}
