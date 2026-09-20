export const ABOUT_COPY = {
  title: 'About',
  howItWorksTitle: 'How it works',
  howItWorks: [
    {
      heading: 'You keep your stock.',
      body: 'Your stock tokens go into an account that only you can empty, as collateral in a lending market. Nothing can send them anywhere but the market or your wallet, and nobody at Accrue can move them.',
      example:
        'Example: you deposit 2 NVDAx at $170, so $340 of stock. Those 2 NVDAx stay yours the whole time.',
    },
    {
      heading: 'You borrow against it.',
      body: 'The market lends you USDC against the stock, 40 percent of its value by default. You pay a variable borrow rate that you can see on every screen with the time it was read.',
      example:
        'Example: 40 percent of $340 is $136, so you owe the market $136 in USDC. At a 5 percent rate that costs $6.80 a year.',
    },
    {
      heading: 'The USDC buys a yield token.',
      body: 'The token is chosen from a short list, each with a target yield, a source, and a line that says how easy it is to sell today. The target is a target.',
      example:
        'Example: the $136 buys 133 ONyc at $1.02 each. ONyc aims at 11.54 percent a year, so about $15.69. After the $6.80 of interest, the position earns about $8.89 a year, 2.6 percent of your $340.',
    },
    {
      heading: 'It is guarded.',
      body: 'If the stock falls, the guard sells a little yield token and repays a little loan before the market can liquidate you. Anyone can run the guard and earn a small bounty. Nobody can make it do anything else, and it never makes your loan bigger unless you switch that on.',
      example:
        "Example: the market liquidates when the loan reaches 65 percent of the stock's value, which for this position is NVDAx at $104.62. The guard acts at 45 percent, NVDAx at $151.11. If NVDAx falls to $150, the guard sells $16 of ONyc, repays $16, the loan is $120, and the liquidation price moves down to $92.31.",
    },
    {
      heading: 'You leave when you want.',
      body: 'One signature sells the yield token, repays the loan and returns the stock.',
      example:
        'Example: after a year at the same price, the ONyc sells for about $151.69, the loan with interest is $142.80, and you get your 2 NVDAx back plus $8.89 minus a 10 percent fee on that profit, $0.89.',
    },
  ],
  whatCanGoWrongTitle: 'What can go wrong',
  whatCanGoWrong: [
    {
      body: 'If the stock falls to the liquidation price, the market sells your tokens to repay the loan and charges a penalty. You can lose a large part of what you put in. The liquidation price is on every screen.',
      example:
        'Example: NVDAx at $104.62 makes your 2 tokens worth $209. The market sells enough of them to repay the $136 plus a penalty, and what is left is a fraction of the $340 you started with.',
    },
    {
      body: 'The borrow rate moves. If it rises above the yield, the position costs money. Interest adds to your loan every day even if the price never moves.',
      example:
        'Example: at 15 percent the $136 loan costs $20.40 a year while the ONyc pays $15.69, so you lose $4.71 a year until you close or the rate falls.',
    },
    {
      body: 'The yield token can pay less than its target and can fall in price. Selling it can take time. While you wait, the loan keeps costing money.',
      example:
        "Example: if ONyc pays 6 percent instead of 11.54, the position earns $8.16 against $6.80 of interest, $1.36 a year. If ONyc's price drops, the guard has less to sell when it needs to.",
    },
    {
      body: 'The guard can be too slow. It can only act while the price sits between the guard line and the liquidation line, and each repay takes a few seconds to land. A fall so fast that the price jumps past both lines at once leaves it no room to act, and a moment with no keeper, no swap route or a stale price does the same. The position is then liquidated like any other. The guard reduces the risk, it does not remove it.',
      example:
        'Example: with the guard at $151.11 and liquidation at $104.62, a slide from $170 to $120 over an hour gives the guard several chances and it repays each time. A jump from $170 to $100 in one price update lands at 68 percent, past the 65 percent line, with no moment in between for a repay.',
    },
    {
      body: 'The code can have a bug. Every instruction ends with checks that undo it on anything unexpected, and it is tested against hostile inputs, but code is written by people.',
      example: null,
    },
    {
      body: "The lending market, the yield token and the swap router are other people's programs. If one of them fails, funds inside can be lost and Accrue cannot recover them. The market also has daily limits on how much collateral can leave and how much can be borrowed, so a withdrawal can fail until the next day, and its risk council can shrink positions in a stock it decides to retire, after a 72 hour warning.",
      example:
        "Example: if the day's withdrawal limit for NVDAx is used up by others before you close, your close fails and works the next day.",
    },
    {
      body: "The stock token is issued by a company that holds the real shares. That company can pause transfers and does not offer the token in every country. The token's price can differ from the real stock.",
      example:
        'Example: a paused NVDAx token cannot leave the market until the pause ends, whatever the position looks like.',
    },
    {
      body: 'Only sign on this domain. Every transaction Accrue asks you to sign shows the balance changes it will cause before you sign. If a screen asks you to sign something without that, it is not ours.',
      example: null,
    },
    {
      body: 'Borrowing, receiving yield and being liquidated can be taxable where you live. Accrue does not know where you live and does not give tax or legal advice.',
      example: null,
    },
  ],
} as const;
