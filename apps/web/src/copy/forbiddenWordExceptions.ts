// Sentences that carry a forbidden word on purpose, because they say what Accrue is not.
export const FORBIDDEN_WORD_EXCEPTIONS: readonly string[] = [
  'The yield token is not a savings account. Its yield is a target that can fall, its price can fall, and selling it can take time while the loan keeps costing money.',
  'You receive at least {} {}, quoted {}, target yield {} percent, not guaranteed.',
  // The four lines of the borrow more explainer. They say what price the position survives down
  // to, which is a fact about this position and its liquidation price, not a claim about Accrue.
  'Today you hold {} {} and owe {}. You are safe down to {}.',
  'If {} rises to {} with this off, you still owe {} and are safe down to {}, a {} fall.',
  'With this on, the position borrows {} more and puts it into {}, so it earns on {} instead of {}, and you are safe down to {}, a {} fall.',
];
