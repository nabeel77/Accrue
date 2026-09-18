import { z } from 'zod';

import { destinationFor, readDefaults } from '../../../server/markets.js';
import { withinTheLimit } from '../../../server/rateLimit.js';
import { ok, readQuery, somethingWentWrong, tooMany } from '../../../server/respond.js';
import { walletOfTheSession } from '../../../server/session.js';
import { latestDestinationTarget } from '../../../server/snapshots.js';

const query = z.object({
  destination: z.string().min(1).max(16).optional(),
  stock: z.string().min(1).max(16).optional(),
  dollars: z
    .string()
    .regex(/^\d{1,12}(\.\d{1,6})?$/u)
    .optional(),
});

export async function GET(request: Request): Promise<Response> {
  const wallet = await walletOfTheSession();
  const limit = await withinTheLimit('read', 'defaults', wallet ?? 'anonymous');
  if (!limit.allowed) {
    return tooMany(limit.retryAfterSeconds);
  }
  const parsed = readQuery(request, query);
  if ('response' in parsed) {
    return parsed.response;
  }

  try {
    const destination = destinationFor(parsed.value.destination);
    const target = await latestDestinationTarget(destination);
    return ok(
      await readDefaults(destination, target.rateBps, target.source, wallet, {
        stockSymbol: parsed.value.stock,
        depositUsd:
          parsed.value.dollars === undefined ? undefined : Number(parsed.value.dollars),
      }),
    );
  } catch (failure) {
    return somethingWentWrong(failure);
  }
}
