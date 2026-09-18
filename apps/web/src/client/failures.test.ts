import { describe, expect, it } from 'vitest';

import { readFailure, readTheAnswer, theWalletSaidNo } from './failures.js';

function answeredWith(status: number, body: string, type: string): Response {
  return new Response(body, { status, headers: { 'content-type': type } });
}

describe('reading what a route answered', () => {
  it('reads a refusal as it was sent', async () => {
    const answer = await readTheAnswer<{ failure?: string }>(
      answeredWith(409, JSON.stringify({ failure: 'noRoute' }), 'application/json'),
    );
    expect(answer.failure).toBe('noRoute');
  });

  // A route that fell over answers a page, and reading that as json used to throw and take the
  // reason with it, which is how a real failure reached a reader as a shrug.
  it('keeps the reason when a route answers a page instead of json', async () => {
    const answer = await readTheAnswer<{ failure?: string }>(
      answeredWith(500, '<!DOCTYPE html><html>Internal Server Error</html>', 'text/html'),
    );
    expect(answer.failure).toBe('somethingWentWrong');
    expect(answer.because).toContain('500');
    expect(answer.because).toContain('Internal Server Error');
  });

  it('keeps the reason when a route answers nothing at all', async () => {
    const answer = await readTheAnswer<{ failure?: string }>(
      answeredWith(502, '', 'text/plain'),
    );
    expect(answer.failure).toBe('somethingWentWrong');
  });
});

describe('turning an answer into a sentence', () => {
  it('names the refusal the server sent', () => {
    expect(readFailure({ refusal: 'nothingToSell' })?.code).toBe('nothingToSell');
  });

  it('fills the numbers the server sent into the sentence', () => {
    const read = readFailure({
      refusal: 'positionTooLarge',
      detail: { maximumUsd: 50_000 },
    });
    expect(read?.sentence).toBe('The largest position is 50000 dollars.');
  });

  it('says nothing it cannot name, so an unmapped refusal is never dressed up', () => {
    expect(readFailure({ refusal: 'somethingNobodyMapped' })).toBe(null);
  });
});

describe('a wallet saying no', () => {
  it('reads the words wallets use for it', () => {
    expect(theWalletSaidNo(new Error('User rejected the request.'))).toBe(true);
    expect(theWalletSaidNo(new Error('the user declined'))).toBe(true);
    expect(theWalletSaidNo(new Error('fetch failed'))).toBe(false);
  });
});
