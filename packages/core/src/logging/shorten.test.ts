import { describe, expect, it } from 'vitest';

import { shortenAddress, shortenEveryAddress } from './shorten.js';

const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const SIGNATURE =
  '5h7s8pFcGvKQhk2W7xJ6FYg1m4HcDXfbPGwa8ZSTuYrNcQdKVmLp3B9RaEi6nTzXuWkJhVdMoy2ScAt4LqPrBeNf';

describe('one address in a line', () => {
  it('keeps four characters at each end and nothing in the middle', () => {
    expect(shortenAddress(WALLET)).toBe('7xKX…gAsU');
  });

  it('leaves something already short alone', () => {
    expect(shortenAddress('short')).toBe('short');
  });
});

describe('a whole log line', () => {
  it('shortens a wallet address wherever it appears', () => {
    expect(shortenEveryAddress(`the owner ${WALLET} asked for a build`)).toBe(
      'the owner 7xKX…gAsU asked for a build',
    );
  });

  it('shortens a signature, which is longer than an address', () => {
    const shortened = shortenEveryAddress(`sent ${SIGNATURE}`);
    expect(shortened).toBe('sent 5h7s…BeNf');
    expect(shortened).not.toContain(SIGNATURE);
  });

  it('shortens every address in one line, not just the first', () => {
    const shortened = shortenEveryAddress(`${WALLET} then ${WALLET}`);
    expect(shortened).toBe('7xKX…gAsU then 7xKX…gAsU');
  });

  it('leaves the words of a sentence alone', () => {
    const line = 'a simulation refused a build: insufficient funds for rent';
    expect(shortenEveryAddress(line)).toBe(line);
  });

  it('shortens an address wrapped in punctuation a chain error puts around it', () => {
    expect(shortenEveryAddress(`Program log: account "${WALLET}" is not writable`)).toBe(
      'Program log: account "7xKX…gAsU" is not writable',
    );
  });

  it('leaves a number alone, however long', () => {
    expect(shortenEveryAddress('1000000000000000000000000000000000000')).toBe(
      '1000000000000000000000000000000000000',
    );
  });
});
