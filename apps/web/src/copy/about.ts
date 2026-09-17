export const ABOUT_COPY = {
  title: 'About',
  howItWorksTitle: 'How it works',
  howItWorks: [
    {
      heading: 'You keep your stock.',
      body: 'Your stock tokens go into an account that only you can empty, as collateral in a lending market. Nothing can send them anywhere but the market or your wallet, and nobody at Accrue can move them.',
    },
    {
      heading: 'You borrow against it.',
      body: 'The market lends you USDC against the stock. You pay a variable borrow rate that you can see on every screen with the time it was read.',
    },
    {
      heading: 'The USDC buys a yield token.',
      body: 'The token is chosen from a short list, each with a target yield, a source, and a line that says how easy it is to sell today. The target is a target.',
    },
    {
      heading: 'It is guarded.',
      body: 'If the stock falls, the guard sells a little yield token and repays a little loan before the market can liquidate you. Anyone can run the guard and earn a small bounty. Nobody can make it do anything else.',
    },
    {
      heading: 'You leave when you want.',
      body: 'One signature sells the yield token, repays the loan and returns the stock.',
    },
  ],
  whatCanGoWrongTitle: 'What can go wrong',
  whatCanGoWrong: [
    'If the stock falls to the liquidation price, the market sells your tokens to repay the loan and charges a penalty. You can lose a large part of what you put in. The liquidation price is on every screen.',
    'The borrow rate moves. If it rises above the yield, the position costs money. Interest adds to your loan every day even if the price never moves.',
    'The yield token can pay less than its target and can fall in price. Selling it can take time. While you wait, the loan keeps costing money.',
    'The guard can be too slow. A fall faster than it can act, a moment with no keeper, no swap route or a stale price, and the position is liquidated like any other. The guard reduces the risk, it does not remove it.',
    'The code can have a bug. Every instruction ends with checks that undo it on anything unexpected, and it is tested against hostile inputs, but code is written by people.',
    'The lending market, the yield token and the swap router are other people’s programs. If one of them fails, funds inside can be lost and Accrue cannot recover them. The market also has daily limits on how much collateral can leave and how much can be borrowed, so a withdrawal can fail until the next day, and its risk council can shrink positions in a stock it decides to retire, after a 72 hour warning.',
    'The stock token is issued by a company that holds the real shares. That company can pause transfers and does not offer the token in every country. The token’s price can differ from the real stock.',
    'Only sign on this domain. Every transaction Accrue asks you to sign shows the balance changes it will cause before you sign. If a screen asks you to sign something without that, it is not ours.',
    'Borrowing, receiving yield and being liquidated can be taxable where you live. Accrue does not know where you live and does not give tax or legal advice.',
  ],
  programLineLabels: {
    program: 'Program',
    build: 'Build',
    upgradeAuthority: 'Upgrade authority',
  },
} as const;
