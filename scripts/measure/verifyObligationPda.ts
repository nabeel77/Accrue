import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';

const KAMINO_LEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const XSTOCKS_MARKET = '5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

const KNOWN_OBLIGATION_OWNER = 'Fa7LNzj3SCV364hya9dx9evL29pC1awx24iHeCEwX6vU';
const KNOWN_OBLIGATION_ADDRESS = '7BACsXdze3FporEnXEbuSHStPPQ58tpZuWb7jgsUYmV';

interface AccountInfoResponse {
  result: { value: { owner: string } | null };
}

const addressEncoder = getAddressEncoder();

const [derivedObligation] = await getProgramDerivedAddress({
  programAddress: address(KAMINO_LEND),
  seeds: [
    new Uint8Array([0]),
    new Uint8Array([0]),
    addressEncoder.encode(address(KNOWN_OBLIGATION_OWNER)),
    addressEncoder.encode(address(XSTOCKS_MARKET)),
    addressEncoder.encode(address(SYSTEM_PROGRAM)),
    addressEncoder.encode(address(SYSTEM_PROGRAM)),
  ],
});

console.log('obligation derived :', derivedObligation);
console.log('obligation expected:', KNOWN_OBLIGATION_ADDRESS);
console.log('match              :', derivedObligation === KNOWN_OBLIGATION_ADDRESS);

const [derivedUserMetadata] = await getProgramDerivedAddress({
  programAddress: address(KAMINO_LEND),
  seeds: [
    new TextEncoder().encode('user_meta'),
    addressEncoder.encode(address(KNOWN_OBLIGATION_OWNER)),
  ],
});

const response = await fetch('https://api.mainnet-beta.solana.com', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getAccountInfo',
    params: [
      derivedUserMetadata,
      { encoding: 'base64', dataSlice: { offset: 0, length: 0 } },
    ],
  }),
});

const payload = (await response.json()) as AccountInfoResponse;
const userMetadataAccount = payload.result.value;

console.log('user metadata      :', derivedUserMetadata);
console.log(
  'user metadata owner:',
  userMetadataAccount === null ? 'does not exist' : userMetadataAccount.owner,
);
