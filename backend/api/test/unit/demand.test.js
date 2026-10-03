/**
 * Comprehensive Unit Tests for backend/api/src/config/demand.js
 * Covers environment variable parsing, fallbacks, numeric bounds, and peak hours lists.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('demand configuration and parsing utilities', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('demandConfig default values and structure', () => {
    it('exports demandConfig object with all mandatory configuration properties', async () => {
      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig).toBeDefined()
      expect(demandConfig).toHaveProperty('baseEarningRate')
      expect(demandConfig).toHaveProperty('routeMultiplierBase')
      expect(demandConfig).toHaveProperty('routeMultiplierStep')
      expect(demandConfig).toHaveProperty('next24HoursFactor')
      expect(demandConfig).toHaveProperty('next48HoursFactor')
      expect(demandConfig).toHaveProperty('peakHours')
    })

    it('assigns correct default fallback numbers when environment variables are completely unset', async () => {
      delete process.env.DEMAND_BASE_EARNING_RATE
      delete process.env.DEMAND_ROUTE_MULTIPLIER_BASE
      delete process.env.DEMAND_ROUTE_MULTIPLIER_STEP
      delete process.env.DEMAND_NEXT_24H_FACTOR
      delete process.env.DEMAND_NEXT_48H_FACTOR
      delete process.env.DEMAND_PEAK_HOURS

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.baseEarningRate).toBe(18.50)
      expect(demandConfig.routeMultiplierBase).toBe(1.2)
      expect(demandConfig.routeMultiplierStep).toBe(0.1)
      expect(demandConfig.next24HoursFactor).toBe(1.1)
      expect(demandConfig.next48HoursFactor).toBe(0.95)
      expect(demandConfig.peakHours).toEqual(['08:00 - 10:00', '17:00 - 19:00'])
    })

    it('validates that all exported configuration values are finite numbers or arrays', async () => {
      const { demandConfig } = await import('../../src/config/demand.js')

      expect(Number.isFinite(demandConfig.baseEarningRate)).toBe(true)
      expect(Number.isFinite(demandConfig.routeMultiplierBase)).toBe(true)
      expect(Number.isFinite(demandConfig.routeMultiplierStep)).toBe(true)
      expect(Number.isFinite(demandConfig.next24HoursFactor)).toBe(true)
      expect(Number.isFinite(demandConfig.next48HoursFactor)).toBe(true)
      expect(Array.isArray(demandConfig.peakHours)).toBe(true)
      expect(demandConfig.peakHours.length).toBeGreaterThan(0)
    })
  })

  describe('parseNumber helper behavior via environment configuration', () => {
    it('correctly parses valid decimal numeric strings from environment variables', async () => {
      process.env.DEMAND_BASE_EARNING_RATE = '25.75'
      process.env.DEMAND_ROUTE_MULTIPLIER_BASE = '1.5'

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.baseEarningRate).toBe(25.75)
      expect(demandConfig.routeMultiplierBase).toBe(1.5)
    })

    it('falls back to default fallback when environment variable is undefined', async () => {
      process.env.DEMAND_ROUTE_MULTIPLIER_STEP = undefined

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.routeMultiplierStep).toBe(0.1)
    })

    it('falls back to default fallback when environment variable is explicitly null', async () => {
      process.env.DEMAND_NEXT_24H_FACTOR = null

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.next24HoursFactor).toBe(1.1)
    })

    it('falls back to default fallback when environment variable is an empty string or whitespace', async () => {
      process.env.DEMAND_NEXT_48H_FACTOR = '   '

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.next48HoursFactor).toBe(0.95)
    })

    it('falls back to default fallback when environment variable is non-finite or NaN string', async () => {
      process.env.DEMAND_BASE_EARNING_RATE = 'not-a-number'

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.baseEarningRate).toBe(18.50)
    })

    it('handles numeric zero correctly instead of treating it as falsy or missing', async () => {
      process.env.DEMAND_ROUTE_MULTIPLIER_STEP = '0'

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.routeMultiplierStep).toBe(0)
    })

    it('parses negative numbers correctly if provided in environment variables', async () => {
      process.env.DEMAND_NEXT_48H_FACTOR = '-0.5'

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.next48HoursFactor).toBe(-0.5)
    })
  })

  describe('parseNumberList helper behavior via environment configuration', () => {
    it('correctly parses comma-separated time strings into trimmed arrays', async () => {
      process.env.DEMAND_PEAK_HOURS = ' 09:00 - 11:00 , 14:00 - 16:00 , 20:00 - 22:00 '

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.peakHours).toEqual([
        '09:00 - 11:00',
        '14:00 - 16:00',
        '20:00 - 22:00',
      ])
    })

    it('filters out empty entries and whitespace-only comma segments', async () => {
      process.env.DEMAND_PEAK_HOURS = '07:00 - 09:00,, , 18:00 - 20:00,'

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.peakHours).toEqual([
        '07:00 - 09:00',
        '18:00 - 20:00',
      ])
    })

    it('falls back to default list when environment variable string is empty or undefined', async () => {
      process.env.DEMAND_PEAK_HOURS = ''

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.peakHours).toEqual(['08:00 - 10:00', '17:00 - 19:00'])
    })

    it('handles single-item comma lists properly without breaking structure', async () => {
      process.env.DEMAND_PEAK_HOURS = '12:00 - 13:00'

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.peakHours).toEqual(['12:00 - 13:00'])
    })
  })

  describe('Edge cases and robustness testing for demand configuration', () => {
    it('ensures module re-evaluation respects dynamic process.env changes across test cycles', async () => {
      process.env.DEMAND_BASE_EARNING_RATE = '55.50'
      const firstImport = await import('../../src/config/demand.js')
      expect(firstImport.demandConfig.baseEarningRate).toBe(55.50)

      process.env.DEMAND_BASE_EARNING_RATE = '75.25'
      vi.resetModules()
      const secondImport = await import('../../src/config/demand.js')
      expect(secondImport.demandConfig.baseEarningRate).toBe(75.25)
    })

    it('handles floating point accuracy safely across multiplier computations', async () => {
      process.env.DEMAND_ROUTE_MULTIPLIER_BASE = '1.12345'
      process.env.DEMAND_ROUTE_MULTIPLIER_STEP = '0.00123'

      const { demandConfig } = await import('../../src/config/demand.js')

      expect(demandConfig.routeMultiplierBase).toBe(1.12345)
      expect(demandConfig.routeMultiplierStep).toBe(0.00123)
    })
  })
})