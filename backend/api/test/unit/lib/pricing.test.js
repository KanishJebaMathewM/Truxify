/**
 * Unit tests for backend/api/src/lib/pricing.js
 *
 * Run with:  npm test -- test/unit/lib/pricing.test.js
 */
import { describe, it, expect } from 'vitest'
import {
  computeOrderPricing,
  haversineKm,
  convertKmToMiles,
} from '../../../src/lib/pricing.js'

describe('pricing — haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(19.076, 72.877, 19.076, 72.877)).toBe(0)
  })

  it('returns a positive distance between Mumbai and Delhi (~1400 km)', () => {
    // Mumbai: 19.0760 N, 72.8777 E
    // Delhi:  28.7041 N, 77.1025 E
    const d = haversineKm(19.076, 72.877, 28.704, 77.102)
    expect(d).toBeGreaterThan(1000)
    expect(d).toBeLessThan(1600)
  })

  it('throws TypeError for non-finite coordinates', () => {
    expect(() => haversineKm(NaN, 72.877, 28.704, 77.102)).toThrow(TypeError)
    expect(() => haversineKm(19.076, Infinity, 28.704, 77.102)).toThrow(TypeError)
    expect(() => haversineKm(19.076, 72.877, NaN, 77.102)).toThrow(TypeError)
    expect(() => haversineKm(19.076, 72.877, 28.704, undefined)).toThrow(TypeError)
  })
})

describe('pricing — convertKmToMiles', () => {
  it('converts 1 km to approximately 0.621371 miles', () => {
    expect(convertKmToMiles(1)).toBeCloseTo(0.621371, 6)
  })

  it('converts 100 km correctly', () => {
    expect(convertKmToMiles(100)).toBeCloseTo(62.1371, 4)
  })

  it('throws TypeError for non-numeric input', () => {
    expect(() => convertKmToMiles('100')).toThrow(TypeError)
    expect(() => convertKmToMiles(NaN)).toThrow(TypeError)
  })
})

describe('pricing — computeOrderPricing', () => {
  const BASE_RATE = 50
  const FRAGILE = 1.5
  const STACKABLE = 0.9
  const HANDLING = 30000
  const PLATFORM_PCT = 5
  const FUEL_PCT = 45
  const TOLL_PER_KM = 200

  const MUMBAI = { pickupLat: 19.076, pickupLng: 72.877, dropLat: 28.704, dropLng: 77.102, weightTonnes: 5 }
  const RATE_CARD = {
    ratePerTonneKm: BASE_RATE,
    fragileMultiplier: FRAGILE,
    stackableDiscount: STACKABLE,
    handlingFee: HANDLING,
    platformFeePct: PLATFORM_PCT,
    fuelCostPct: FUEL_PCT,
    tollPerKm: TOLL_PER_KM,
  }

  it('computes pricing with road distance', () => {
    const result = computeOrderPricing({ ...MUMBAI, roadDistanceKm: 500 }, RATE_CARD)
    expect(result.distanceKm).toBe(500)
    expect(result.baseFreight).toBeGreaterThan(HANDLING)
    expect(result.tollEstimate).toBeGreaterThan(0)
    expect(result.platformFee).toBeGreaterThan(0)
    expect(result.totalAmount).toBeGreaterThan(result.baseFreight)
  })

  it('falls back to haversine distance when roadDistanceKm is null', () => {
    const result = computeOrderPricing({ ...MUMBAI, roadDistanceKm: null }, RATE_CARD)
    expect(result.distanceKm).toBeGreaterThan(0)
  })

  it('falls back to haversine distance when roadDistanceKm is undefined', () => {
    const result = computeOrderPricing({ ...MUMBAI, roadDistanceKm: undefined }, RATE_CARD)
    expect(result.distanceKm).toBeGreaterThan(0)
  })

  it('falls back to haversine distance when roadDistanceKm is NaN', () => {
    const result = computeOrderPricing({ ...MUMBAI, roadDistanceKm: NaN }, RATE_CARD)
    expect(result.distanceKm).toBeGreaterThan(0)
  })

  it('applies fragile multiplier when isFragile is true', () => {
    const base = computeOrderPricing({ ...MUMBAI, roadDistanceKm: 100 }, RATE_CARD)
    const fragile = computeOrderPricing({ ...MUMBAI, roadDistanceKm: 100, isFragile: true }, RATE_CARD)
    expect(fragile.baseFreight).toBeGreaterThan(base.baseFreight)
    const expectedExtra = Math.round(BASE_RATE * 1.5 * 5 * 100) - Math.round(BASE_RATE * 5 * 100)
    expect(fragile.baseFreight - base.baseFreight).toBe(expectedExtra)
  })

  it('applies stackable discount when isStackable is true', () => {
    const base = computeOrderPricing({ ...MUMBAI, roadDistanceKm: 100 }, RATE_CARD)
    const stackable = computeOrderPricing({ ...MUMBAI, roadDistanceKm: 100, isStackable: true }, RATE_CARD)
    expect(stackable.baseFreight).toBeLessThan(base.baseFreight)
  })

  it('throws TypeError when input is not an object', () => {
    expect(() => computeOrderPricing(null)).toThrow(TypeError)
    expect(() => computeOrderPricing(undefined)).toThrow(TypeError)
    expect(() => computeOrderPricing('MUMBAI')).toThrow(TypeError)
  })

  it('throws RangeError when weightTonnes is not positive', () => {
    expect(() => computeOrderPricing({ ...MUMBAI, weightTonnes: 0 }, RATE_CARD)).toThrow(RangeError)
    expect(() => computeOrderPricing({ ...MUMBAI, weightTonnes: -5 }, RATE_CARD)).toThrow(RangeError)
    expect(() => computeOrderPricing({ ...MUMBAI, weightTonnes: NaN }, RATE_CARD)).toThrow(RangeError)
  })

  it('returns all required fields in the result object', () => {
    const result = computeOrderPricing({ ...MUMBAI, roadDistanceKm: 200 }, RATE_CARD)
    expect(result).toHaveProperty('distanceKm')
    expect(result).toHaveProperty('baseFreight')
    expect(result).toHaveProperty('tollEstimate')
    expect(result).toHaveProperty('platformFee')
    expect(result).toHaveProperty('totalAmount')
    expect(result).toHaveProperty('fuelCost')
    expect(result).toHaveProperty('netProfit')
  })

  it('totalAmount equals baseFreight + tollEstimate + platformFee', () => {
    const result = computeOrderPricing({ ...MUMBAI, roadDistanceKm: 250 }, RATE_CARD)
    expect(result.totalAmount).toBe(result.baseFreight + result.tollEstimate + result.platformFee)
  })

  it('respects custom tollFactor', () => {
    const noToll = computeOrderPricing({ ...MUMBAI, roadDistanceKm: 100, tollFactor: 1 }, RATE_CARD)
    const highToll = computeOrderPricing({ ...MUMBAI, roadDistanceKm: 100, tollFactor: 2 }, RATE_CARD)
    expect(highToll.tollEstimate).toBe(Math.round(noToll.tollEstimate * 2))
  })
})
