/**
 * Unit tests for backend/api/src/services/carbonTokenService.js
 *
 * The service previously coerced every input with Number() and never checked
 * the result, so `fuel_saved_liters: 'abc'` minted a token whose co2SavedKg and
 * tokenAmount were NaN, and negative distances/weights were accepted. Those
 * bogus credits could then be retired as corporate Scope 3 offsets.
 *
 * Run with:  npm test -- test/unit/carbonTokenService.test.js
 */
import { describe, it, expect, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

const { carbonTokenService } = await import('../../src/services/carbonTokenService.js');
const { ValidationError } = await import('../../src/utils/errors.js');

const base = {
  truckId: 'TR-1',
  tripId: 'TP-1',
  distanceKm: 450,
  fuelSavedLiters: 12,
  loadWeightKg: 9000,
};

describe('carbonTokenService.calculateAndMintCarbonCredits', () => {
  it('mints a credit from valid telematics figures', async () => {
    const token = await carbonTokenService.calculateAndMintCarbonCredits({ ...base });
    // 12 L * 2.68 = 32.16 kg CO2 = 0.0322 metric tons
    expect(token.co2SavedKg).toBe(32.16);
    expect(token.co2SavedMetricTons).toBe(0.0322);
    expect(token.tokenAmount).toBe(0.0322);
    expect(token.status).toBe('MINTED');
    expect(token.distanceKm).toBe(450);
    expect(token.loadWeightKg).toBe(9000);
  });

  it('coerces numeric strings', async () => {
    const token = await carbonTokenService.calculateAndMintCarbonCredits({
      ...base,
      distanceKm: '450',
      fuelSavedLiters: '12',
      loadWeightKg: '9000',
    });
    expect(token.fuelSavedLiters).toBe(12);
    expect(token.co2SavedKg).toBe(32.16);
  });

  it('defaults optional measurements to 0', async () => {
    const token = await carbonTokenService.calculateAndMintCarbonCredits({
      truckId: 'TR-2',
      tripId: 'TP-2',
      fuelSavedLiters: 5,
    });
    expect(token.distanceKm).toBe(0);
    expect(token.loadWeightKg).toBe(0);
  });

  it('rejects a non-numeric fuel_saved_liters instead of minting NaN credits', async () => {
    for (const fuelSavedLiters of ['abc', '12abc', NaN, Infinity, -Infinity]) {
      await expect(
        carbonTokenService.calculateAndMintCarbonCredits({ ...base, fuelSavedLiters }),
        `fuelSavedLiters=${String(fuelSavedLiters)}`,
      ).rejects.toThrow(ValidationError);
    }
  });

  it('rejects a negative fuel_saved_liters', async () => {
    await expect(
      carbonTokenService.calculateAndMintCarbonCredits({ ...base, fuelSavedLiters: -100 }),
    ).rejects.toThrow(/must not be negative/);
  });

  it('rejects a negative distance', async () => {
    await expect(
      carbonTokenService.calculateAndMintCarbonCredits({ ...base, distanceKm: -50 }),
    ).rejects.toThrow(/must not be negative/);
  });

  it('rejects a negative load weight', async () => {
    await expect(
      carbonTokenService.calculateAndMintCarbonCredits({ ...base, loadWeightKg: -5000 }),
    ).rejects.toThrow(/must not be negative/);
  });

  it('rejects a non-finite distance or load weight', async () => {
    await expect(
      carbonTokenService.calculateAndMintCarbonCredits({ ...base, distanceKm: 'abc' }),
    ).rejects.toThrow(/finite/);
    await expect(
      carbonTokenService.calculateAndMintCarbonCredits({ ...base, loadWeightKg: Infinity }),
    ).rejects.toThrow(/finite/);
  });

  it('refuses to mint a zero-value credit', async () => {
    await expect(
      carbonTokenService.calculateAndMintCarbonCredits({ ...base, fuelSavedLiters: 0 }),
    ).rejects.toThrow(/greater than 0/);
  });

  it('still requires truckId, tripId and fuelSavedLiters', async () => {
    await expect(
      carbonTokenService.calculateAndMintCarbonCredits({ ...base, truckId: undefined }),
    ).rejects.toThrow(/Missing required parameters/);
    await expect(
      carbonTokenService.calculateAndMintCarbonCredits({ ...base, tripId: '' }),
    ).rejects.toThrow(/Missing required parameters/);
    await expect(
      carbonTokenService.calculateAndMintCarbonCredits({ ...base, fuelSavedLiters: undefined }),
    ).rejects.toThrow(/Missing required parameters/);
  });

  it('never persists a NaN field', async () => {
    const token = await carbonTokenService.calculateAndMintCarbonCredits({ ...base });
    for (const [key, value] of Object.entries(token)) {
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `${key} should be finite`).toBe(true);
      }
    }
  });
});

describe('carbonTokenService.purchaseCarbonCredits', () => {
  it('retires a minted credit for a shipper', async () => {
    const token = await carbonTokenService.calculateAndMintCarbonCredits({ ...base });
    const retired = await carbonTokenService.purchaseCarbonCredits({
      tokenId: token.tokenId,
      buyerAddress: '0xBuyer',
      shipperId: 'SH-1',
    });
    expect(retired.status).toBe('RETIRED_FOR_OFFSET');
    expect(retired.buyerAddress).toBe('0xBuyer');
    expect(retired.shipperId).toBe('SH-1');
    expect(retired.transferTxHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('refuses to retire the same credit twice', async () => {
    const token = await carbonTokenService.calculateAndMintCarbonCredits({ ...base });
    const purchase = () => carbonTokenService.purchaseCarbonCredits({
      tokenId: token.tokenId,
      buyerAddress: '0xBuyer',
      shipperId: 'SH-1',
    });
    await purchase();
    await expect(purchase()).rejects.toThrow(/already been redeemed/);
  });

  it('rejects an unknown token', async () => {
    await expect(
      carbonTokenService.purchaseCarbonCredits({
        tokenId: 'CCT-nope',
        buyerAddress: '0xBuyer',
        shipperId: 'SH-1',
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('carbonTokenService.getTokenDetails', () => {
  it('returns null for an unknown token', async () => {
    expect(await carbonTokenService.getTokenDetails('CCT-nope')).toBeNull();
  });
});
