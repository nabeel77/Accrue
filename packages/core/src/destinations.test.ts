import { describe, expect, it } from 'vitest';

import {
  DESTINATIONS,
  destinationBySymbol,
  destinationForMint,
  passesEveryEligibilityCheck,
  shownDestinations,
  type Destination,
} from './destinations.js';

describe('the yield tokens a position can go into', () => {
  it('records all five checks against every entry', () => {
    for (const destination of DESTINATIONS) {
      expect(passesEveryEligibilityCheck(destination)).toBe(true);
      expect(destination.eligibility.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    }
  });

  it('never shows one that failed a check', () => {
    const first = DESTINATIONS[0];
    expect(first).toBeDefined();
    const withoutAFeed: Destination = {
      ...first!,
      eligibility: { ...first!.eligibility, hasAScopeFeed: false },
    };
    expect(passesEveryEligibilityCheck(withoutAFeed)).toBe(false);
    expect(shownDestinations()).toHaveLength(DESTINATIONS.length);
  });

  it('says where the yield comes from in one sentence', () => {
    for (const destination of DESTINATIONS) {
      expect(destination.yieldSource.match(/[.!?]/gu)).toHaveLength(1);
      expect(destination.yieldSource.endsWith('.')).toBe(true);
    }
  });

  it('is found by mint and by symbol', () => {
    expect(destinationBySymbol('ONyc')?.exitType).toBe('request');
    expect(
      destinationForMint('5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5')?.symbol,
    ).toBe('ONyc');
    expect(destinationForMint('not a mint')).toBeNull();
  });

  it('carries a target rate with the place it came from', () => {
    for (const destination of DESTINATIONS) {
      expect(destination.targetRateBps).toBeGreaterThan(0);
      expect(destination.targetRateSource.length).toBeGreaterThan(0);
    }
  });
});
