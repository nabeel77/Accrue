export const DEPOSIT_COPY = {
  stockColumnTitle: 'Stock',
  stockEmpty: 'Your wallet holds none of these yet.',
  earnInColumnTitle: 'Earn in',
  amountMax: 'MAX',
  intoPrefix: 'Into',
  targetSuffix: 'target',
  earnsAbout: 'Earns about',
  liquidatedIf: 'Liquidated if',
  falls: 'falls',
  guardRepaysAt: 'Guard repays at',
  guardNote: 'automatic, before liquidation',
  deposit: 'Deposit',
  adjust: 'Adjust',
  oneSignatureNote:
    'One signature, your position lives in an account only you can empty.',
  referenceLine:
    'Lending the USDC straight back earns less than the loan costs, so that path loses money.',
} as const;

export const ADJUST_COPY = {
  title: 'Adjust',
  resetToDefault: 'Reset to default',
  accrueDefault: 'Accrue default',
  borrowLabel: 'Borrow',
  borrowNote: 'How much USDC the position borrows against your stock.',
  guardLabel: 'Guard repays at',
  guardNote:
    'The loan to value the guard acts at, always under the liquidation threshold.',
  growLabel: 'Grow when the stock rises',
  growNote:
    'Borrow back up to target when the stock has risen, and buy more of the yield token.',
  leaveLabel: 'Leave if the market retires this stock',
  leaveNote: 'Anyone can return the position to you when the market retires the reserve.',
  detailsLabel: 'Details',
  done: 'Done',
  overridePrompt: 'Type override to continue.',
  overrideWord: 'override',
} as const;

export const REVIEW_COPY = {
  title: 'Read this, then sign',
  walletAfter: 'Wallet after signing',
  sign: 'Sign',
} as const;
