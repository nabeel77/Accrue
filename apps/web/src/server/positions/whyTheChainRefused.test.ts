import { describe, expect, it } from 'vitest';

import { everyReason, whyTheChainRefused } from './whyTheChainRefused.js';

const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

describe('what the chain said', () => {
  it('reads a dead blockhash as a build that waited too long', () => {
    expect(whyTheChainRefused(new Error('Blockhash not found'))).toBe('buildExpired');
    expect(whyTheChainRefused(new Error('block height exceeded'))).toBe('buildExpired');
  });

  it('reads a stale oracle as a stale oracle', () => {
    expect(whyTheChainRefused(new Error('Error Code: PriceTooOld'))).toBe('staleOracle');
    expect(whyTheChainRefused(new Error('OraclePriceIsStale'))).toBe('staleOracle');
  });

  it('reads a program error or missing funds as the chain refusing it', () => {
    expect(
      whyTheChainRefused(
        new Error('Transaction simulation failed: custom program error'),
      ),
    ).toBe('simulationFailed');
    expect(whyTheChainRefused(new Error('insufficient funds for fee'))).toBe(
      'simulationFailed',
    );
  });

  it('does not claim to know what a plain network failure was', () => {
    expect(whyTheChainRefused(new Error('fetch failed'))).toBe(null);
    expect(whyTheChainRefused('not even an error')).toBe(null);
  });
});

describe('the reason written to the log', () => {
  it('follows the causes so the first message is not the only one kept', () => {
    const failure = new Error('outer', { cause: new Error('inner') });
    expect(everyReason(failure)).toBe('outer <- inner');
  });

  it('shortens every address, so no log line carries a whole one', () => {
    const said = everyReason(new Error(`account ${WALLET} is not writable`));
    expect(said).toBe('account 7xKX…gAsU is not writable');
    expect(said).not.toContain(WALLET);
  });

  it('keeps the context an rpc error carries, which is where the logs are', () => {
    const failure = Object.assign(new Error('send failed'), {
      context: { logs: ['Program log: PriceTooOld'] },
    });
    expect(everyReason(failure)).toContain('PriceTooOld');
    expect(whyTheChainRefused(failure)).toBe('staleOracle');
  });
});
