import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FuelAdvisorService } from '../../src/services/fuelAdvisorService.js'

function makeChain(result) {
  const chain = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  return chain
}

function makeLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }
}

function makeService(overrides = {}) {
  const logger = overrides.logger || makeLogger()
  const weatherService = overrides.weatherService || {
    getWeatherForecast: vi.fn().mockResolvedValue({ temperature_c: 20 }),
  }
  const supabase = overrides.supabase || makeChain({ data: null, error: null })
  const service = new FuelAdvisorService({
    supabase,
    weatherService,
    logger,
    fuelPrices: { truck: 100, van: 90, car: 95, default: 100 },
    ...overrides,
  })
  return { service, logger, weatherService, supabase }
}

function expectFiniteEstimate(result) {
  expect(result.success).toBe(true)
  expect(Number.isFinite(result.distanceKm)).toBe(true)
  expect(Number.isFinite(result.fuelUsedLitres)).toBe(true)
  expect(Number.isFinite(result.fuelCost)).toBe(true)
}

beforeEach(() => {
  vi.clearAllMocks()
})
describe('FuelAdvisorService constructor', () => {
  it('accepts and stores the injected logger', () => {
    const logger = makeLogger()
    const { service } = makeService({ logger })

    expect(service.logger).toBe(logger)
  })

  it('stores the injected data and weather dependencies', () => {
    const supabase = makeChain({ data: null, error: null })
    const weatherService = { getWeatherForecast: vi.fn() }
    const { service } = makeService({ supabase, weatherService })

    expect(service.supabase).toBe(supabase)
    expect(service.weatherService).toBe(weatherService)
  })

  it('provides standard efficiency values for supported vehicle types', () => {
    const { service } = makeService()

    expect(service.fuelEfficiency).toEqual({ truck: 3.5, van: 8, car: 12 })
  })

  it('allows callers to override fuel prices and efficiency values', () => {
    const { service } = makeService({
      fuelPrices: { truck: 110 },
      fuelEfficiency: { truck: 4 },
    })

    expect(service.fuelPrices).toEqual({ truck: 110 })
    expect(service.fuelEfficiency.truck).toBe(4)
  })
})

describe('FuelAdvisorService.tripFuelEstimate', () => {
  it('calculates litres and cost for a valid truck trip', () => {
    const { service } = makeService()

    const result = service.tripFuelEstimate(350, 'truck', 100)

    expectFiniteEstimate(result)
    expect(result).toMatchObject({
      distanceKm: 350,
      vehicleType: 'truck',
      fuelEfficiencyKmPerLitre: 3.5,
      fuelUsedLitres: 100,
      fuelPricePerLitre: 100,
      fuelCost: 10000,
    })
  })

  it('uses the configured price when no price override is supplied', () => {
    const { service } = makeService()

    const result = service.tripFuelEstimate(80, 'van')

    expect(result.success).toBe(true)
    expect(result.fuelPricePerLitre).toBe(90)
    expect(result.fuelUsedLitres).toBe(10)
    expect(result.fuelCost).toBe(900)
  })

  it('uses the default configured price for an explicitly configured fallback', () => {
    const { service } = makeService({ fuelPrices: { default: 75 } })

    const result = service.tripFuelEstimate(35, 'truck')

    expect(result.success).toBe(true)
    expect(result.fuelPricePerLitre).toBe(75)
    expect(result.fuelCost).toBe(750)
  })

  it('normalizes vehicle type casing', () => {
    const { service } = makeService()

    const result = service.tripFuelEstimate(12, 'VAN', 90)

    expect(result.success).toBe(true)
    expect(result.vehicleType).toBe('van')
    expect(result.fuelUsedLitres).toBe(1.5)
  })

  it('returns zero cost for zero distance', () => {
    const { service } = makeService()

    const result = service.tripFuelEstimate(0, 'truck', 100)

    expect(result).toMatchObject({
      success: true,
      distanceKm: 0,
      fuelUsedLitres: 0,
      fuelCost: 0,
    })
  })

  it('accepts numeric strings for distance and fuel price', () => {
    const { service } = makeService()

    const result = service.tripFuelEstimate('70', 'truck', '105')

    expect(result.success).toBe(true)
    expect(result.distanceKm).toBe(70)
    expect(result.fuelPricePerLitre).toBe(105)
    expect(result.fuelCost).toBe(2100)
  })

  it.each([null, undefined, NaN, Infinity, -1, 'not-a-number'])(
    'returns an error for invalid distance %p',
    (distance) => {
      const { service } = makeService()

      const result = service.tripFuelEstimate(distance, 'truck', 100)

      expect(result).toEqual({
        success: false,
        error: 'distanceKm must be a non-negative finite number',
      })
    },
  )

  it.each([null, undefined, '', 'unknown', 'motorcycle'])(
    'returns an error for unsupported vehicle type %p',
    (vehicleType) => {
      const { service } = makeService()

      const result = service.tripFuelEstimate(100, vehicleType, 100)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unsupported vehicle type')
    },
  )
  it('rejects an omitted vehicle type instead of defaulting to truck', () => {
    const { service } = makeService()

    const result = service.tripFuelEstimate(100, undefined, 100)

    expect(result).toEqual({
      success: false,
      error: 'Unsupported vehicle type: undefined',
    })
  })

  it.each([null, undefined, NaN, Infinity, -1, 'invalid'])(
    'returns an error when the fuel price is missing or invalid: %p',
    (price) => {
      const { service } = makeService({ fuelPrices: {} })

      const result = service.tripFuelEstimate(100, 'truck', price)

      expect(result).toEqual({
        success: false,
        error: 'fuelPricePerLitre must be a finite non-negative number',
      })
    },
  )

  it('allows a zero fuel price without producing NaN', () => {
    const { service } = makeService()

    const result = service.tripFuelEstimate(100, 'truck', 0)

    expectFiniteEstimate(result)
    expect(result.fuelCost).toBe(0)
  })

  it('logs invalid distance input at debug level', () => {
    const logger = makeLogger()
    const { service } = makeService({ logger })

    service.tripFuelEstimate(NaN, 'truck', 100)

    expect(logger.debug).toHaveBeenCalledWith('[FuelAdvisorService] Invalid trip distance supplied')
  })

  it('logs unsupported vehicle input at debug level', () => {
    const logger = makeLogger()
    const { service } = makeService({ logger })

    service.tripFuelEstimate(100, 'bus', 100)

    expect(logger.debug).toHaveBeenCalledWith('[FuelAdvisorService] Unsupported vehicle type: bus')
  })

  it('logs missing fuel price at debug level', () => {
    const logger = makeLogger()
    const { service } = makeService({ logger, fuelPrices: {} })

    service.tripFuelEstimate(100, 'truck')

    expect(logger.debug).toHaveBeenCalledWith('[FuelAdvisorService] Fuel price is unavailable')
  })

  it('logs the completed estimate with its calculated values', () => {
    const logger = makeLogger()
    const { service } = makeService({ logger })

    const result = service.tripFuelEstimate(10, 'car', 100)

    expect(logger.debug).toHaveBeenCalledWith(
      '[FuelAdvisorService] Trip fuel estimate calculated',
      result,
    )
  })

  it('returns finite values for every supported default vehicle type', () => {
    const { service } = makeService()

    for (const vehicleType of ['truck', 'van', 'car']) {
      expectFiniteEstimate(service.tripFuelEstimate(100, vehicleType, 100))
    }
  })
})

describe('FuelAdvisorService.routeFuelEstimate', () => {
  it('returns zero totals for an empty route', () => {
    const { service } = makeService()

    const result = service.routeFuelEstimate([], 'truck', 100)

    expect(result).toEqual({
      success: true,
      legs: 0,
      distanceKm: 0,
      fuelUsedLitres: 0,
      fuelCost: 0,
      vehicleType: 'truck',
    })
  })

  it('combines multiple distanceKm legs correctly', () => {
    const { service } = makeService()

    const result = service.routeFuelEstimate(
      [{ distanceKm: 35 }, { distanceKm: 70 }, { distanceKm: 105 }],
      'truck',
      100,
    )

    expectFiniteEstimate(result)
    expect(result).toMatchObject({
      legs: 3,
      distanceKm: 210,
      fuelUsedLitres: 60,
      fuelCost: 6000,
      vehicleType: 'truck',
      fuelPricePerLitre: 100,
    })
    expect(result.estimates).toHaveLength(3)
  })

  it('accepts numeric legs as a convenience input', () => {
    const { service } = makeService()

    const result = service.routeFuelEstimate([10, 20, 30], 'van', 80)

    expect(result.success).toBe(true)
    expect(result.legs).toBe(3)
    expect(result.distanceKm).toBe(60)
    expect(result.fuelUsedLitres).toBe(7.5)
    expect(result.fuelCost).toBe(600)
  })

  it('accepts distance and distance_km leg property names', () => {
    const { service } = makeService()

    const result = service.routeFuelEstimate(
      [{ distance: 12 }, { distance_km: 8 }],
      'car',
      100,
    )

    expect(result.success).toBe(true)
    expect(result.distanceKm).toBe(20)
    expect(result.fuelUsedLitres).toBe(20 / 12)
    expect(result.fuelCost).toBe((20 / 12) * 100)
  })

  it('supports a per-leg fuel price override', () => {
    const { service } = makeService()

    const result = service.routeFuelEstimate(
      [{ distanceKm: 35, fuelPricePerLitre: 80 }, { distanceKm: 35, fuelPricePerLitre: 120 }],
      'truck',
    )

    expect(result.success).toBe(true)
    expect(result.fuelCost).toBe(2000)
    expect(result.estimates[0].fuelPricePerLitre).toBe(80)
    expect(result.estimates[1].fuelPricePerLitre).toBe(120)
  })

  it('applies one route-level price override to every leg', () => {
    const { service } = makeService()

    const result = service.routeFuelEstimate([{ distanceKm: 35 }, { distanceKm: 70 }], 'truck', 110)

    expect(result.success).toBe(true)
    expect(result.fuelCost).toBe(3300)
    expect(result.estimates.every(estimate => estimate.fuelPricePerLitre === 110)).toBe(true)
  })

  it.each([null, undefined, {}, 'not-an-array'])(
    'returns an error for invalid route legs: %p',
    (legs) => {
      const { service } = makeService()

      const result = service.routeFuelEstimate(legs, 'truck', 100)

      expect(result).toEqual({ success: false, error: 'legs must be an array' })
    },
  )
  it('rejects an omitted route instead of defaulting to an empty route', () => {
    const { service } = makeService()

    const result = service.routeFuelEstimate(undefined, 'truck', 100)

    expect(result).toEqual({ success: false, error: 'legs must be an array' })
  })

  it('returns the invalid leg error and stops aggregation', () => {
    const { service } = makeService()

    const result = service.routeFuelEstimate(
      [{ distanceKm: 40 }, { distanceKm: -1 }, { distanceKm: 40 }],
      'truck',
      100,
    )

    expect(result).toEqual({
      success: false,
      error: 'distanceKm must be a non-negative finite number',
      legIndex: 1,
    })
  })

  it('returns an error when a leg omits its distance', () => {
    const { service } = makeService()

    const result = service.routeFuelEstimate([{ name: 'missing distance' }], 'truck', 100)

    expect(result.success).toBe(false)
    expect(result.error).toBe('distanceKm must be a non-negative finite number')
  })

  it('returns an invalid-distance error for a null route leg', () => {
    const { service } = makeService()

    const result = service.routeFuelEstimate([null], 'truck', 100)

    expect(result).toEqual({
      success: false,
      error: 'distanceKm must be a non-negative finite number',
      legIndex: 0,
    })
  })

  it('returns an error for an unsupported route vehicle type', () => {
    const { service } = makeService()

    const result = service.routeFuelEstimate([{ distanceKm: 100 }], 'spaceship', 100)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unsupported vehicle type')
    expect(result.legIndex).toBe(0)
  })

  it('logs aggregate route calculations at info level', () => {
    const logger = makeLogger()
    const { service } = makeService({ logger })

    const result = service.routeFuelEstimate([{ distanceKm: 35 }], 'truck', 100)

    expect(logger.info).toHaveBeenCalledWith(
      '[FuelAdvisorService] Route fuel estimate calculated',
      result,
    )
  })
})

