/**
 * The rescue page stands on its own, so its words live with it. The copy test reads this file the
 * same way it reads the app's.
 */
export const RESCUE_COPY = {
  title: 'Return everything to my wallet',
  intro: 'Connect the wallet that owns the position.',
  clusterLabel: 'Network',
  endpointLabel: 'Endpoint',
  connect: 'Connect wallet',
  connecting: 'Connecting',
  noWallet: 'No wallet answered. Install one and reload this page.',
  reading: 'Reading the chain',
  none: 'This wallet owns no positions.',
  button: 'Return everything to my wallet',
  working: 'Returning',
  done: 'Everything is back in your wallet and the position is closed.',
  returned: 'Everything this position could hand back is in your wallet.',
  stillOwed: (amount: string): string =>
    `${amount} USDC is still owed. Settling it needs that much USDC in your wallet, and the position stays open until it is paid.`,
  failed: 'That did not go through. Try again.',
  positionLabel: 'Position',
  collateralLabel: 'Stock',
  destinationLabel: 'Yield token',
  stateLabel: 'State',
  signatureLabel: 'Transaction',
} as const;
