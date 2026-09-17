export const RESCUE_COPY = {
  title: 'Return everything to my wallet',
  intro: 'Connect the wallet that owns the position.',
  connect: 'Connect wallet',
  button: 'Return everything to my wallet',
  working: 'Returning',
  repayFirst: (amount: string): string => `Repay ${amount} USDC first.`,
  none: 'This wallet owns no positions.',
  clusterLabel: 'Cluster',
} as const;
