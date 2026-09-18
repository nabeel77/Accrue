export const LANDING_COPY = {
  wordmark: 'accrue',
  openApp: 'Open app',
  scrollHint: 'Scroll',
  hero: {
    headline: 'Your stocks, working.',
    subheadline:
      'Borrow against your tokenized stocks. Earn on the loan. Guarded automatically.',
  },
  beats: [
    {
      index: '02',
      heading: 'Keep the stock.',
      body: 'It stays yours. Full upside.',
    },
    {
      index: '03',
      heading: 'Borrow against it.',
      body: 'USDC at a live rate.',
    },
    {
      index: '04',
      heading: 'Earn on the loan.',
      body: 'The USDC goes into a yield token that targets more than the loan costs.',
    },
    {
      index: '05',
      heading: 'Guarded.',
      body: 'If the stock falls, the guard repays part of the loan before liquidation. Automatically.',
    },
    {
      index: '06',
      heading: 'Leave any time.',
      body: 'One signature returns everything.',
    },
  ],
  borrowFigures: {
    borrowedLabel: 'Borrowed',
    borrowCostLabel: 'Borrow cost',
    borrowCostValue: '5.05%',
    aYearLabel: 'A year',
  },
  dial: {
    caption: 'of your stock',
  },
  reserve: {
    label: 'Collateral',
  },
  destinations: [
    { name: 'Insurance', target: '11.54%' },
    { name: 'Credit', target: '6.73%' },
    { name: 'Lending', target: '4.72%' },
    { name: 'Treasuries', target: '3.57%' },
  ],
  destinationTargetLabel: 'target',
  guard: {
    symbol: 'NVDAx',
    tag: 'Guard repaid $100',
    loanLabel: 'Loan',
    liquidatedAtPrefix: 'liquidated at ',
  },
  wallet: {
    title: 'Your wallet',
    address: '7xKX…9fQ2',
    stockRow: 'NVDAx',
    borrowRow: 'USDC',
    destinationRow: 'Yield token',
    note: 'Loan repaid. Nothing left behind.',
  },
  followToken: {
    symbol: 'NVDAx',
    value: '$1,000.00',
    badge: 'Yours',
  },
  heroChart: {
    liquidationLabel: 'liquidation 117.33',
    guardTickLabel: 'guard repaid $80',
    gridLabels: ['176.00', '160.00', '144.00', '128.00'],
  },
  ticker: [
    { symbol: 'SPYx', price: '662.10', change: '+0.4%', rising: true },
    { symbol: 'QQQx', price: '588.42', change: '+0.6%', rising: true },
    { symbol: 'NVDAx', price: '176.00', change: '−1.2%', rising: false },
    { symbol: 'TSLAx', price: '412.80', change: '+2.1%', rising: true },
    { symbol: 'GOOGLx', price: '251.30', change: '−0.3%', rising: false },
    { symbol: 'AAPLx', price: '234.15', change: '+0.2%', rising: true },
    { symbol: 'METAx', price: '741.22', change: '+0.9%', rising: true },
    { symbol: 'HOODx', price: '128.64', change: '−1.8%', rising: false },
    { symbol: 'CRCLx', price: '132.90', change: '+3.4%', rising: true },
    { symbol: 'MSTRx', price: '338.70', change: '−2.6%', rising: false },
  ],
} as const;
