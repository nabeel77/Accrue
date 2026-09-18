import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { Address, KeyPairSigner } from '@solana/kit';

import { answer, readBody, theSecretMatches, theSharedSecret } from './httpService.js';
import { currentPrices, savePrices, startingPrices } from './priceBook.js';
import { ensureThePricesAccountExists, writeEveryPrice } from './prices.js';
import {
  accrueTheYield,
  boundsBySymbol,
  clampToTheBounds,
  knobsFromTheEnvironment,
  stepAStock,
  theStocksThatAreWalked,
  theWriteIntervalTheGuardCanLiveWith,
  theYieldRateOf,
  type Step,
  type WalkState,
} from './priceWalk.js';
import { setThePoolRates } from './router.js';
import {
  adminSigner,
  connectToDevnet,
  namedSigner,
  reportServiceSignature,
  reportStep,
  type Cluster,
} from './shared.js';
import { SANDBOX_TOKENS, tokenBySymbol } from './tokens.js';

const DEFAULT_PORT = 8788;
const A_SECOND = 1_000;

interface Feed {
  readonly cluster: Cluster;
  readonly admin: KeyPairSigner;
  readonly programAddress: Address;
  readonly prices: Address;
}

function reportStepLine(step: Step): void {
  reportStep(
    `  ${step.symbol.padEnd(6)} ${step.from.toFixed(6)} -> ${step.to.toFixed(6)}  ${step.why}`,
  );
}

// One write of every price, and the swap pool's rates with them, so a route costs what the
// oracle says a token is worth.
async function writeEverything(
  feed: Feed,
  values: Record<string, number>,
): Promise<string> {
  const signature = await writeEveryPrice(
    feed.cluster,
    feed.admin,
    feed.programAddress,
    feed.prices,
    values,
  );
  reportServiceSignature('prices written', signature);
  const rates = await setThePoolRates(
    feed.cluster,
    feed.admin,
    (await namedSigner('honest-swap')).address,
    values,
  );
  if (rates !== undefined) {
    reportServiceSignature('router rates written', rates);
  }
  return signature;
}

function moveOneToken(
  values: Record<string, number>,
  symbol: string,
  percent: number,
): Step {
  const token = tokenBySymbol(symbol);
  const bounds = boundsBySymbol().get(token.symbol);
  if (bounds === undefined) {
    throw new Error(`${token.symbol} has no price bounds`);
  }
  const from = values[token.symbol] ?? token.startingPrice;
  const to = clampToTheBounds(from * (1 + percent / 100), bounds);
  return { symbol: token.symbol, from, to, why: `asked for ${percent} percent` };
}

async function handleMove(
  feed: Feed,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readBody(request);
  const parsed = JSON.parse(body === '' ? '{}' : body) as {
    symbol?: unknown;
    percent?: unknown;
  };
  if (typeof parsed.symbol !== 'string' || typeof parsed.percent !== 'number') {
    answer(response, 400, { error: 'send a symbol and a percent' });
    return;
  }
  const step = moveOneToken(currentPrices(), parsed.symbol, parsed.percent);
  const values = { ...currentPrices(), [step.symbol]: step.to };
  savePrices(values);
  reportStep(`${new Date().toISOString()}  asked to move ${step.symbol}`);
  reportStepLine(step);
  const signature = await writeEverything(feed, values);
  answer(response, 200, {
    symbol: step.symbol,
    from: step.from,
    to: step.to,
    signature,
  });
}

async function handleReset(feed: Feed, response: ServerResponse): Promise<void> {
  const values = startingPrices();
  savePrices(values);
  reportStep(`${new Date().toISOString()}  asked to reset every price to the book`);
  const signature = await writeEverything(feed, values);
  answer(response, 200, { reset: true, signature });
}

function serve(feed: Feed, port: number): void {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      answer(response, 200, { ok: true });
      return;
    }
    if (request.method !== 'POST' || !['/move', '/reset'].includes(request.url ?? '')) {
      answer(response, 404, { error: 'post to /move or /reset' });
      return;
    }
    if (!theSecretMatches(request)) {
      answer(response, 401, { error: 'this service only answers its own server' });
      return;
    }
    const work =
      request.url === '/move'
        ? handleMove(feed, request, response)
        : handleReset(feed, response);
    void work.catch((failure: unknown) => {
      answer(response, 502, {
        error: failure instanceof Error ? failure.message : 'that did not land',
      });
    });
  });
  server.listen(port, () => {
    reportStep(
      `devnet prices listening on ${port}, shared secret ${
        theSharedSecret() === '' ? 'not set, so every caller is refused' : 'required'
      }`,
    );
  });
}

async function main(): Promise<void> {
  const cluster = connectToDevnet();
  const admin = await adminSigner();
  const priceFeed = await namedSigner('price-feed');
  const prices = await ensureThePricesAccountExists(cluster, admin, priceFeed.address);
  const feed: Feed = { cluster, admin, programAddress: priceFeed.address, prices };

  const asked = knobsFromTheEnvironment();
  const writing = theWriteIntervalTheGuardCanLiveWith(asked.writeSeconds);
  const knobs = { ...asked, writeSeconds: writing.seconds };
  const bounds = boundsBySymbol();
  const walked = theStocksThatAreWalked();
  const states = new Map<string, WalkState>(
    walked.map((token) => [token.symbol, { recoveryStepsLeft: 0 }]),
  );

  reportStep(`prices account      ${prices}`);
  reportStep(
    `writing ${writing.note}, stepping every ${knobs.stepSeconds}s, up to ${knobs.stepPercent} percent a step`,
  );
  reportStep(
    `a big move of ${knobs.bigMoveLowPercent} to ${knobs.bigMoveHighPercent} percent down on about one step in ${Math.round(1 / knobs.bigMoveOdds)}, recovering over ${knobs.recoverySteps} steps`,
  );
  serve(feed, Number(process.env['DEVNET_PRICES_PORT'] ?? DEFAULT_PORT));

  const earnedSinceTheLastStep = new Map<string, number>();
  let lastStepAt = 0;
  let lastWriteAt = Date.now();
  for (;;) {
    const roundStartedAt = Date.now();
    try {
      const values = { ...currentPrices() };

      // The yield token earns for however long it has been since the last write.
      const sinceTheLastWrite = (roundStartedAt - lastWriteAt) / A_SECOND;
      lastWriteAt = roundStartedAt;
      for (const token of SANDBOX_TOKENS) {
        const rateBps = theYieldRateOf(token);
        const bound = bounds.get(token.symbol);
        if (rateBps === null || bound === undefined || sinceTheLastWrite <= 0) {
          continue;
        }
        const earned = accrueTheYield(
          token,
          values[token.symbol] ?? token.startingPrice,
          rateBps,
          sinceTheLastWrite,
          bound,
        );
        values[token.symbol] = earned.to;
      }

      if (roundStartedAt - lastStepAt >= knobs.stepSeconds * A_SECOND) {
        lastStepAt = roundStartedAt;
        reportStep(`${new Date().toISOString()}  stepping the market`);
        for (const token of walked) {
          const state = states.get(token.symbol);
          const bound = bounds.get(token.symbol);
          if (state === undefined || bound === undefined) {
            continue;
          }
          const step = stepAStock(
            token,
            values[token.symbol] ?? token.startingPrice,
            bound,
            knobs,
            state,
          );
          values[token.symbol] = step.to;
          reportStepLine(step);
        }
        // The yield token has no step of its own, so its line says what it earned since the last.
        for (const token of SANDBOX_TOKENS) {
          const rateBps = theYieldRateOf(token);
          const now = values[token.symbol] ?? token.startingPrice;
          if (rateBps === null) {
            continue;
          }
          reportStepLine({
            symbol: token.symbol,
            from: earnedSinceTheLastStep.get(token.symbol) ?? now,
            to: now,
            why: `earning ${(rateBps / 100).toFixed(2)} percent a year`,
          });
          earnedSinceTheLastStep.set(token.symbol, now);
        }
      }

      savePrices(values);
      await writeEverything(feed, values);
    } catch (failure) {
      reportStep(
        `${new Date().toISOString()}  that round did not land: ${failure instanceof Error ? failure.message : 'unknown'}`,
      );
    }
    // The interval is how often a price is written, not the gap after writing one: two
    // confirmations can take most of a window on their own.
    const waitFor = Math.max(
      0,
      knobs.writeSeconds * A_SECOND - (Date.now() - roundStartedAt),
    );
    await new Promise((wake) => setTimeout(wake, waitFor));
  }
}

await main();
