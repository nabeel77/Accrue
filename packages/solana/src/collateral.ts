import { address, type Address } from '@solana/kit';

import { clusterName, currentCluster } from './clusters/index.js';

// A stock we accept as collateral.
export interface CollateralToken {
  readonly symbol: string;
  readonly name: string;
  readonly mint: Address;
  readonly reserve: Address;
  readonly issuer: string;
}

// The xStocks market's stock reserves, read live on 14 September 2026.
const MAINNET_COLLATERAL: readonly CollateralToken[] = [
  {
    symbol: 'SPYx',
    name: 'SPDR S&P 500 ETF Trust',
    mint: address('XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W'),
    reserve: address('UvXjBuC7YZYaGB9Rn1PpBD1GySmjzunXgE8Zev9ua8d'),
    issuer: 'Backed Finance',
  },
  {
    symbol: 'QQQx',
    name: 'Invesco QQQ Trust',
    mint: address('Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ'),
    reserve: address('2jerdAXR8r2B6z3P7P6VgSiePQX7wqcpbEqdDbm8mgeB'),
    issuer: 'Backed Finance',
  },
  {
    symbol: 'GOOGLx',
    name: 'Alphabet',
    mint: address('XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN'),
    reserve: address('4wg6rEkGgHaEuxMduP46C1xFZ24Lnp5YgdNkZAHxFzsN'),
    issuer: 'Backed Finance',
  },
  {
    symbol: 'TSLAx',
    name: 'Tesla',
    mint: address('XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB'),
    reserve: address('5iTiczqgUegqA3PpoNpotizMbY9n1sRWr3oL6igKvWuf'),
    issuer: 'Backed Finance',
  },
  {
    symbol: 'NVDAx',
    name: 'NVIDIA',
    mint: address('Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'),
    reserve: address('7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q'),
    issuer: 'Backed Finance',
  },
  {
    symbol: 'AAPLx',
    name: 'Apple',
    mint: address('XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp'),
    reserve: address('CKJbqakbPGyhziowm19LPYz636UszuezfkitmpRtcLSH'),
    issuer: 'Backed Finance',
  },
  {
    symbol: 'METAx',
    name: 'Meta Platforms',
    mint: address('Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu'),
    reserve: address('AJPrye7NZGex2rUZhRwiAPJYxai1Ptb7DNWR3yYjtk3G'),
    issuer: 'Backed Finance',
  },
  {
    symbol: 'HOODx',
    name: 'Robinhood Markets',
    mint: address('XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg'),
    reserve: address('4UBJu5Xp1aziV9frBQBhc1RnKrgXHAWHYejQytkYr8gq'),
    issuer: 'Backed Finance',
  },
  {
    symbol: 'CRCLx',
    name: 'Circle Internet Group',
    mint: address('XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1'),
    reserve: address('57qagnQFuWw1seEqi6Z5JBvkm5xH5svdmq9dtqxG1rYy'),
    issuer: 'Backed Finance',
  },
  {
    symbol: 'MSTRx',
    name: 'Strategy',
    mint: address('XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ'),
    reserve: address('Cwy2WJoswCMyfPtWTrmiaDLXC3phz3qwr1TaT4kaSAyD'),
    issuer: 'Backed Finance',
  },
];

// The sandbox has two mock stocks, shaped like the real ones and worth nothing.
function sandboxCollateral(): CollateralToken[] {
  const cluster = currentCluster();
  const wanted: readonly { symbol: string; name: string }[] = [
    { symbol: 'NVDAx', name: 'NVIDIA, a test token' },
    { symbol: 'SPYx', name: 'SPDR S&P 500 ETF Trust, a test token' },
  ];
  return wanted.flatMap(({ symbol, name }) => {
    const mint = cluster.mints[symbol];
    const reserve = cluster.reserves[symbol];
    return mint === undefined || reserve === undefined
      ? []
      : [{ symbol, name, mint, reserve, issuer: 'the Accrue sandbox' }];
  });
}

export function theStockCatalogue(): readonly CollateralToken[] {
  return MAINNET_COLLATERAL;
}

export function collateralAllowlist(): readonly CollateralToken[] {
  return clusterName() === 'mainnet' ? MAINNET_COLLATERAL : sandboxCollateral();
}

// Matched on the mint and nothing else.
export function collateralForMint(mint: Address): CollateralToken | null {
  return collateralAllowlist().find((token) => token.mint === mint) ?? null;
}

export function isAllowedCollateral(mint: Address): boolean {
  return collateralForMint(mint) !== null;
}
