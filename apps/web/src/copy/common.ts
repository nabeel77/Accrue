export const NAV = {
  deposit: 'Deposit',
  portfolio: 'Portfolio',
  activity: 'Activity',
  about: 'About',
} as const;

export const COMMON = {
  connectWallet: 'Connect wallet',
  signIn: 'Sign in',
  signOut: 'Sign out',
  signingIn: 'Signing in',
  signMessagePrompt: 'Sign one message to prove this wallet is yours.',
  missingValue: '—',
  loading: 'Reading the chain',
  tryAgain: 'Try again',
  close: 'Close',
  done: 'Done',
  cancel: 'Cancel',
  oneSignature: '1 signature',
} as const;

export const DEVNET = {
  banner: 'This is devnet. The tokens here are test tokens and have no value.',
  getTestTokens: 'Get test tokens',
  gettingTestTokens: 'Sending test tokens',
  testTokensSent: 'Test tokens are in your wallet.',
  testTokensFailed: 'The faucet could not send tokens right now.',
} as const;
