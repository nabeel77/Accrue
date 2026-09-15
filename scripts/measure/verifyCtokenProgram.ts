import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeBase58 } from '../shared/base58.js';

const fixtures = resolve(import.meta.dirname, '../../tests/fixtures/accounts');
const COLLATERAL_MINT_OFFSET = 2560;

const reserveFiles = readdirSync(fixtures).filter((name) => name.startsWith('reserve_'));
const ctokenMints = reserveFiles.map((name) => {
  const fixture = JSON.parse(readFileSync(resolve(fixtures, name), 'utf8')) as {
    data_base64: string;
  };
  const bytes = Buffer.from(fixture.data_base64, 'base64');
  return {
    reserve: name.replace('reserve_', '').replace('.json', ''),
    ctokenMint: encodeBase58(
      bytes.subarray(COLLATERAL_MINT_OFFSET, COLLATERAL_MINT_OFFSET + 32),
    ),
  };
});

const response = await fetch('https://api.mainnet-beta.solana.com', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getMultipleAccounts',
    params: [
      ctokenMints.map((entry) => entry.ctokenMint),
      { encoding: 'base64', dataSlice: { offset: 0, length: 0 } },
    ],
  }),
});
const payload = (await response.json()) as {
  result: { value: ({ owner: string } | null)[] };
};

ctokenMints.forEach((entry, index) => {
  const account = payload.result.value[index];
  console.log(
    `${entry.reserve.padEnd(20)} ctoken=${entry.ctokenMint} owner=${account?.owner ?? 'MISSING'}`,
  );
});
