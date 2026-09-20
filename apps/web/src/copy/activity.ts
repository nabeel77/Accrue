export const ACTIVITY_COPY = {
  title: 'Activity',
  empty: 'Nothing has happened on your positions yet.',
  protect: 'Guard repaid part of the loan',
  grow: 'Guard borrowed back to target',
  leave: 'Position returned to your wallet',
  'top-up': 'You added to this position',
  line: (what: string, amount: string, caller: string): string =>
    `${what}${amount}${caller}`,
  forAmount: (amount: string): string => `, ${amount} USDC`,
  byCaller: (caller: string): string => `, by ${caller}`,
  columnWhen: 'When',
  columnWhat: 'What',
  columnAmount: 'Amount',
  // Who called the guard. Ours or anyone else's, it is public either way.
  columnCaller: 'Caller',
  columnTransaction: 'Transaction',
} as const;
