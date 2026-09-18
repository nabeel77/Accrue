import 'server-only';

import { address } from '@solana/kit';
import { desc } from 'drizzle-orm';

import { schema } from '@accrue/db';

import { db } from './database.js';
import { currentCluster, PRIMARY_TRANSACTION_VERSION } from '@accrue/solana';

import { positionByAddress } from './positions/list.js';
import { optional } from './env.js';
import { chain } from './rpc.js';

type GuardEventKind = 'protect' | 'grow' | 'leave';

const KINDS: Readonly<Record<string, GuardEventKind>> = {
  'Instruction: Protect': 'protect',
  'Instruction: Grow': 'grow',
  'Instruction: Leave': 'leave',
};

// Where the position sits in each instruction's account list, so the row names a real position.
const POSITION_ACCOUNT_INDEX: Readonly<Record<GuardEventKind, number>> = {
  protect: 3,
  grow: 2,
  leave: 2,
};

interface CompiledMessage {
  readonly accountKeys?: readonly string[];
  readonly instructions?: readonly {
    readonly programIdIndex: number;
    readonly accounts: readonly number[];
  }[];
}

function positionFromTheMessage(
  message: CompiledMessage | undefined,
  programId: string,
  kind: GuardEventKind,
): string | null {
  const keys = message?.accountKeys ?? [];
  for (const instruction of message?.instructions ?? []) {
    if (keys[instruction.programIdIndex] !== programId) {
      continue;
    }
    const at = instruction.accounts[POSITION_ACCOUNT_INDEX[kind]];
    const position = at === undefined ? undefined : keys[at];
    if (position !== undefined) {
      return position;
    }
  }
  return null;
}

interface TokenBalanceEntry {
  readonly accountIndex: number;
  readonly mint: string;
  readonly owner?: string;
  readonly uiTokenAmount: { readonly amount: string };
}

interface TokenMovement {
  readonly owner: string | null;
  readonly mint: string;
  readonly delta: bigint;
}

function tokenMovements(meta: {
  readonly preTokenBalances?: readonly TokenBalanceEntry[] | null;
  readonly postTokenBalances?: readonly TokenBalanceEntry[] | null;
}): TokenMovement[] {
  const before = new Map<number, bigint>();
  for (const entry of meta.preTokenBalances ?? []) {
    before.set(entry.accountIndex, BigInt(entry.uiTokenAmount.amount));
  }
  const movements: TokenMovement[] = [];
  for (const entry of meta.postTokenBalances ?? []) {
    movements.push({
      owner: entry.owner ?? null,
      mint: entry.mint,
      delta: BigInt(entry.uiTokenAmount.amount) - (before.get(entry.accountIndex) ?? 0n),
    });
  }
  return movements;
}

function absolute(amount: bigint): bigint {
  return amount < 0n ? -amount : amount;
}

function asRawAmount(amount: bigint | null): string | null {
  return amount === null ? null : `${amount}`;
}

function usdcMovedOnTheMarket(
  movements: readonly TokenMovement[],
  usdcMint: string,
  position: string,
  caller: string,
): bigint | null {
  let largest = 0n;
  for (const movement of movements) {
    if (movement.mint !== usdcMint) {
      continue;
    }
    if (movement.owner === position || movement.owner === caller) {
      continue;
    }
    const size = absolute(movement.delta);
    if (size > largest) {
      largest = size;
    }
  }
  return largest === 0n ? null : largest;
}

function movedForTheOwner(
  movements: readonly TokenMovement[],
  owner: string,
  mint: string,
): bigint | null {
  for (const movement of movements) {
    if (movement.owner === owner && movement.mint === mint && movement.delta !== 0n) {
      return absolute(movement.delta);
    }
  }
  return null;
}

// Every protect, grow and leave the chain has seen since the newest one already stored, read
// from the program's own signatures. Anyone's keeper shows up here, not only ours.
export async function catchUpOnGuardEvents(): Promise<number> {
  const programId = optional('ACCRUE_PROGRAM_ID');
  if (programId === undefined) {
    return 0;
  }
  const [newest] = await db()
    .select({ slot: schema.guardEvents.slot })
    .from(schema.guardEvents)
    .orderBy(desc(schema.guardEvents.slot))
    .limit(1);
  const since = newest?.slot ?? 0n;
  const usdcMint = currentCluster().mints['USDC'] ?? '';

  const signatures = await chain()
    .rpc.getSignaturesForAddress(address(programId), { limit: 100 })
    .send();

  let written = 0;
  for (const entry of signatures) {
    if (entry.err !== null || entry.slot <= since) {
      continue;
    }
    const transaction = await chain()
      .rpc.getTransaction(entry.signature, {
        encoding: 'json',
        maxSupportedTransactionVersion: PRIMARY_TRANSACTION_VERSION,
        commitment: 'confirmed',
      })
      .send();
    const logs = transaction?.meta?.logMessages ?? [];
    const kind = Object.entries(KINDS).find(([needle]) =>
      logs.some((line) => line.includes(needle)),
    )?.[1];
    if (kind === undefined) {
      continue;
    }
    const message = transaction?.transaction.message as CompiledMessage | undefined;
    const position = positionFromTheMessage(message, programId, kind);
    const caller = message?.accountKeys?.[0];
    if (position === null || caller === undefined) {
      continue;
    }
    const stored = await positionByAddress(position);
    const movements = tokenMovements(transaction?.meta ?? {});
    await db()
      .insert(schema.guardEvents)
      .values({
        signature: entry.signature,
        positionId: stored?.id ?? null,
        positionAddress: position,
        kind,
        callerAddress: caller,
        usdcAmountRaw: asRawAmount(
          usdcMovedOnTheMarket(movements, usdcMint, position, caller),
        ),
        destinationAmountRaw: asRawAmount(
          stored === null
            ? null
            : movedForTheOwner(movements, position, stored.destinationMint),
        ),
        bountyRaw: asRawAmount(movedForTheOwner(movements, caller, usdcMint)),
        slot: entry.slot,
        at: new Date(Number(entry.blockTime ?? 0) * 1_000),
      })
      .onConflictDoNothing();
    written += 1;
  }
  return written;
}
