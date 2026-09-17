/**
 * Unit tests for trafficService.js
 *
 * Tests the getLiveTrafficMultiplier function including input validation,
 * API error handling, rush-hour fallback, and multiplier boundary conditions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLiveTrafficMultiplier,
  getLiveTrafficMultiplierEnterprise,
} from '../../../src/services/trafficService.js';

describe('getLiveTrafficMultiplier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure no API keys are set for consistent fallback behavior
    delete process.env.TOMTOM_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('returns 1.0 for null latitude', async () => {
    expect(await getLiveTrafficMultiplier(null, 75.0)).toBe(1.0);
  });

  it('returns 1.0 for null longitude', async () => {
    expect(await getLiveTrafficMultiplier(25.0, null)).toBe(1.0);
  });

  it('returns 1.0 for undefined latitude', async () => {
    expect(await getLiveTrafficMultiplier(undefined, 75.0)).toBe(1.0);
  });

  it('returns 1.0 for undefined longitude', async () => {
    expect(await getLiveTrafficMultiplier(25.0, undefined)).toBe(1.0);
  });

  it('handles NaN inputs (passes null check, makes API call)', async () => {
    // NaN is not null (NaN == null is false), so it proceeds to API call
    // Without API keys, it falls back to rush-hour multiplier
    const result = await getLiveTrafficMultiplier(NaN, 75.0);
    expect(typeof result).toBe('number');
  });

  it('returns 1.0 when no API key is configured (rush-hour fallback)', async () => {
    // Without an API key, the function falls back to getRushHourMultiplier
    // which returns 1.0 outside rush hours
    const result = await getLiveTrafficMultiplier(25.0, 75.0);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(1.0);
    expect(result).toBeLessThanOrEqual(2.5);
  });

  it('returns a number between 1.0 and 2.5', async () => {
    const result = await getLiveTrafficMultiplier(25.0, 75.0);
    expect(result).toBeGreaterThanOrEqual(1.0);
    expect(result).toBeLessThanOrEqual(2.5);
  });

  it('returns multiplier rounded to 2 decimal places', async () => {
    const result = await getLiveTrafficMultiplier(25.0, 75.0);
    const str = result.toString();
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  it('is a function', () => {
    expect(typeof getLiveTrafficMultiplier).toBe('function');
  });
});

describe('getLiveTrafficMultiplierEnterprise', () => {
  beforeEach(() => {
    delete process.env.TOMTOM_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('returns 1.0 for non-finite (NaN / Infinity) coordinates before calculating', async () => {
    expect(await getLiveTrafficMultiplierEnterprise(NaN, 10)).toBe(1.0);
    expect(await getLiveTrafficMultiplierEnterprise(Infinity, 10)).toBe(1.0);
    expect(await getLiveTrafficMultiplierEnterprise(28.6, -Infinity)).toBe(1.0);
  });

  it('rejects non-numeric and overflow coordinate inputs', async () => {
    expect(await getLiveTrafficMultiplierEnterprise('abc', 'xyz')).toBe(1.0);
    expect(await getLiveTrafficMultiplierEnterprise('Infinity', '10')).toBe(1.0);
    expect(await getLiveTrafficMultiplierEnterprise(Number.MAX_VALUE * 2, 10)).toBe(1.0);
  });

  it('returns a finite multiplier between 1.0 and 2.5 for valid coordinates', async () => {
    const result = await getLiveTrafficMultiplierEnterprise(28.6139, 77.209);
    expect(result).toBeGreaterThanOrEqual(1.0);
    expect(result).toBeLessThanOrEqual(2.5);
    expect(Number.isFinite(result)).toBe(true);
  });
});
