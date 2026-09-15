export interface MainnetAccountToCapture {
  label: string;
  address: string;
  description: string;
}

/**
 * Everything the program suite replays against. Each entry says why it is here, and the
 * LiteSVM harness asserts that no entry is captured without a reason.
 */
export const MAINNET_ACCOUNTS_TO_CAPTURE: MainnetAccountToCapture[] = [
  {
    label: 'xstocks_market',
    address: '5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua',
    description: 'The xStocks lending market every position borrows against.',
  },
  {
    label: 'xstocks_lookup_table',
    address: '8ofreL6hKfEet1DnhHVGvCTnSdz4pg85PpbuCUHnEcKm',
    description: 'The market lookup table the version 0 fallback path compresses with.',
  },

  {
    label: 'reserve_spyx',
    address: 'UvXjBuC7YZYaGB9Rn1PpBD1GySmjzunXgE8Zev9ua8d',
    description: 'SPYx reserve: max loan to value and liquidation threshold for SPYx.',
  },
  {
    label: 'reserve_qqqx',
    address: '2jerdAXR8r2B6z3P7P6VgSiePQX7wqcpbEqdDbm8mgeB',
    description: 'QQQx reserve.',
  },
  {
    label: 'reserve_googlx',
    address: '4wg6rEkGgHaEuxMduP46C1xFZ24Lnp5YgdNkZAHxFzsN',
    description: 'GOOGLx reserve.',
  },
  {
    label: 'reserve_tslax',
    address: '5iTiczqgUegqA3PpoNpotizMbY9n1sRWr3oL6igKvWuf',
    description: 'TSLAx reserve.',
  },
  {
    label: 'reserve_nvdax',
    address: '7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q',
    description: 'NVDAx reserve: the collateral in every worked example.',
  },
  {
    label: 'reserve_aaplx',
    address: 'CKJbqakbPGyhziowm19LPYz636UszuezfkitmpRtcLSH',
    description: 'AAPLx reserve.',
  },
  {
    label: 'reserve_metax',
    address: 'AJPrye7NZGex2rUZhRwiAPJYxai1Ptb7DNWR3yYjtk3G',
    description: 'METAx reserve.',
  },
  {
    label: 'reserve_hoodx',
    address: '4UBJu5Xp1aziV9frBQBhc1RnKrgXHAWHYejQytkYr8gq',
    description: 'HOODx reserve.',
  },
  {
    label: 'reserve_crclx',
    address: '57qagnQFuWw1seEqi6Z5JBvkm5xH5svdmq9dtqxG1rYy',
    description: 'CRCLx reserve.',
  },
  {
    label: 'reserve_mstrx',
    address: 'Cwy2WJoswCMyfPtWTrmiaDLXC3phz3qwr1TaT4kaSAyD',
    description: 'MSTRx reserve.',
  },
  {
    label: 'reserve_usdc',
    address: '97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E',
    description: 'USDC reserve: the borrow side, its rate and its free liquidity.',
  },

  {
    label: 'mint_spyx',
    address: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
    description:
      'SPYx mint, Token 2022, for the scaled UI amount extension and decimals.',
  },
  {
    label: 'mint_qqqx',
    address: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
    description: 'QQQx mint.',
  },
  {
    label: 'mint_googlx',
    address: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN',
    description: 'GOOGLx mint.',
  },
  {
    label: 'mint_tslax',
    address: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
    description: 'TSLAx mint.',
  },
  {
    label: 'mint_nvdax',
    address: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    description: 'NVDAx mint.',
  },
  {
    label: 'mint_aaplx',
    address: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    description: 'AAPLx mint.',
  },
  {
    label: 'mint_metax',
    address: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu',
    description: 'METAx mint.',
  },
  {
    label: 'mint_hoodx',
    address: 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg',
    description: 'HOODx mint.',
  },
  {
    label: 'mint_crclx',
    address: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1',
    description: 'CRCLx mint.',
  },
  {
    label: 'mint_mstrx',
    address: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ',
    description: 'MSTRx mint.',
  },
  {
    label: 'mint_usdc',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    description: 'USDC mint, the borrow asset.',
  },
  {
    label: 'mint_onyc',
    address: '5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5',
    description: 'ONyc mint, the first yield destination.',
  },

  {
    label: 'program_kamino_lend',
    address: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
    description:
      'The deployed Kamino Lend program the position calls for deposit, borrow, repay and withdraw.',
  },
  {
    label: 'program_scope',
    address: 'HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ',
    description: 'The Scope oracle program, the same prices the lending market reads.',
  },
  {
    label: 'program_jupiter_v6',
    address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    description: 'Jupiter v6, the swap router every route is built against.',
  },
];
