/**
 * Sentences that carry a forbidden word on purpose, because they say what Accrue is not. Each one
 * must match the copy exactly; an edited sentence has to be approved here again.
 */
export const FORBIDDEN_WORD_EXCEPTIONS: readonly string[] = [
  'The yield token is not a savings account. Its yield is a target that can fall, its price can fall, and selling it can take time while the loan keeps costing money.',
  'Lending the USDC straight back earns less than the loan costs, so that path loses money.',
  'You receive at least {} {}, quoted {}, target yield {} percent, not guaranteed.',
];
