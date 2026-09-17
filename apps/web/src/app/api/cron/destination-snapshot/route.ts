import { DESTINATIONS } from '@accrue/core';
import { createDatabaseClient, schema } from '@accrue/db';

import { cronIsAuthorised } from '../../../../server/cron.js';
import { optional } from '../../../../server/env.js';
import { ok, refuse, somethingWentWrong } from '../../../../server/respond.js';

interface LlamaPool {
  readonly pool: string;
  readonly apy?: number;
  readonly apyMean30d?: number;
  readonly tvlUsd?: number;
}

export async function POST(request: Request): Promise<Response> {
  if (!cronIsAuthorised(request)) {
    return refuse('No.', 401);
  }
  try {
    const url = optional('DEFILLAMA_YIELDS_URL') ?? 'https://yields.llama.fi/pools';
    const answer = (await (await fetch(url)).json()) as { data?: LlamaPool[] };
    const pools = answer.data ?? [];

    const rows = DESTINATIONS.flatMap((destination) => {
      const pool = pools.find((entry) => entry.pool === destination.defiLlamaPoolId);
      if (pool === undefined) {
        return [];
      }
      return [
        {
          destinationMint: destination.mainnetMint,
          apy: (pool.apy ?? 0).toFixed(6),
          apy30d: pool.apyMean30d === undefined ? null : pool.apyMean30d.toFixed(6),
          tvlUsd: pool.tvlUsd === undefined ? null : pool.tvlUsd.toFixed(6),
          source: 'DefiLlama',
        },
      ];
    });
    if (rows.length > 0) {
      await createDatabaseClient().insert(schema.destinationSnapshots).values(rows);
    }
    return ok({ written: rows.length });
  } catch (failure) {
    return somethingWentWrong(failure);
  }
}
