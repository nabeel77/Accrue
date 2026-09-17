import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { decodeReserve, type ReserveSnapshot } from './layout.js';
import { borrowRateBps, supplyRateBps, utilisationBps } from './rates.js';

const fixtures = resolve(import.meta.dirname, '../../../../tests/fixtures/accounts');

function reserve(label: string): ReserveSnapshot {
  const captured = JSON.parse(
    readFileSync(resolve(fixtures, `${label}.json`), 'utf8'),
  ) as { data_base64: string };
  return decodeReserve(Uint8Array.from(Buffer.from(captured.data_base64, 'base64')));
}

describe('the rates a reserve charges and pays', () => {
  it('reads the USDC reserve the way the lending market shows it', () => {
    const usdc = reserve('reserve_usdc');
    // 4,832,817 borrowed against 773,881 available is 86.19 percent lent out.
    expect(utilisationBps(usdc)).toBe(8_619);
    // The curve is flat to 5.14 percent at 90 percent, so 86.19 percent sits just under it. The
    // market's own page read 5.05 percent the day the fixture was taken.
    expect(borrowRateBps(usdc)).toBe(492);
    // What is paid, times the lent share, less the market's ten percent cut. Its page read 3.90.
    expect(supplyRateBps(usdc)).toBe(382);
  });

  it('charges the first point of the curve on a reserve nobody borrows from', () => {
    const nvdax = reserve('reserve_nvdax');
    expect(utilisationBps(nvdax)).toBe(36);
    expect(borrowRateBps(nvdax)).toBe(301);
  });

  it('follows the straight line between two points of the curve', () => {
    const usdc = reserve('reserve_usdc');
    const halfway: ReserveSnapshot = {
      ...usdc,
      borrowRateCurve: [
        { utilisationBps: 0, borrowRateBps: 0 },
        { utilisationBps: 10_000, borrowRateBps: 2_000 },
      ],
    };
    // 86.19 percent of the way from 0 to 2,000 is 1,724.
    expect(borrowRateBps(halfway)).toBe(1_724);
  });

  it('pays nothing on a reserve with nothing lent out', () => {
    const usdc = reserve('reserve_usdc');
    const idle: ReserveSnapshot = { ...usdc, liquidityBorrowedScaled: 0n };
    expect(utilisationBps(idle)).toBe(0);
    expect(supplyRateBps(idle)).toBe(0);
  });
});
