import { describe, expect, it } from 'vitest';

import {
  CURRENT_RISK_ACKNOWLEDGEMENT_VERSION,
  RISK_ACKNOWLEDGEMENT_HASH,
  RISK_ACKNOWLEDGEMENT_SENTENCES,
  acknowledgementIsCurrent,
  riskAcknowledgementHash,
} from './acknowledgement.js';

describe('the risk acknowledgement', () => {
  it('hashes to the value stored beside its version', () => {
    expect(riskAcknowledgementHash()).toBe(RISK_ACKNOWLEDGEMENT_HASH);
  });

  it('is the four sentences and no more', () => {
    expect(RISK_ACKNOWLEDGEMENT_SENTENCES).toHaveLength(4);
    for (const sentence of RISK_ACKNOWLEDGEMENT_SENTENCES) {
      expect(sentence.trim().length).toBeGreaterThan(0);
    }
  });

  it('accepts only the version that is current', () => {
    expect(acknowledgementIsCurrent(CURRENT_RISK_ACKNOWLEDGEMENT_VERSION)).toBe(true);
    expect(acknowledgementIsCurrent(CURRENT_RISK_ACKNOWLEDGEMENT_VERSION - 1)).toBe(
      false,
    );
    expect(acknowledgementIsCurrent(null)).toBe(false);
  });
});
