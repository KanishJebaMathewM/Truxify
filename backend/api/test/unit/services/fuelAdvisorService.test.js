import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FuelAdvisorService, calculateFuelEfficiency } from '../../../src/services/fuelAdvisorService.js';
import { DomainError } from '../../../src/services/order/domainError.js';

function makeChain(result) {
  const chain = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeService(overrides = {}) {
  const logger = overrides.logger || makeLogger();
  const weatherService = overrides.weatherService || {
    getWeatherForecast: vi.fn().mockResolvedValue({ temperature_c: 20 }),
  };
  const supabase = overrides.supabase || makeChain({ data: null, error: null });
  const service = new FuelAdvisorService({
    supabase,
    weatherService,
    logger,
    fuelPrices: { truck: 100, van: 90, car: 95, default: 100 },
    ...overrides,
  });
  return { service, logger, weatherService, supabase };
}

describe('FuelAdvisorService - Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateFuelEfficiency', () => {
    it('calculates fuel efficiency for valid positive numbers and numeric strings', () => {
      expect(calculateFuelEfficiency(100, 25)).toBe(4);
      expect(calculateFuelEfficiency(350, 100)).toBe(3.5);
      expect(calculateFuelEfficiency(0, 10)).toBe(0);
      expect(calculateFuelEfficiency('120', '30')).toBe(4);
      expect(calculateFuelEfficiency('70', 20)).toBe(3.5);
    });

    it('returns default or custom fallback for invalid distance or fuel amount', () => {
      expect(calculateFuelEfficiency(null, 25)).toBe(0);
      expect(calculateFuelEfficiency(100, null)).toBe(0);
      expect(calculateFuelEfficiency(undefined, 25)).toBe(0);
      expect(calculateFuelEfficiency(100, undefined)).toBe(0);
      expect(calculateFuelEfficiency(NaN, 25)).toBe(0);
      expect(calculateFuelEfficiency(100, NaN)).toBe(0);
      expect(calculateFuelEfficiency(Infinity, 25)).toBe(0);
      expect(calculateFuelEfficiency(100, Infinity)).toBe(0);
      expect(calculateFuelEfficiency(-10, 25)).toBe(0);
      expect(calculateFuelEfficiency(100, 0)).toBe(0);
      expect(calculateFuelEfficiency(100, -5)).toBe(0);
      expect(calculateFuelEfficiency('invalid', 25)).toBe(0);
      expect(calculateFuelEfficiency(100, 'invalid')).toBe(0);

      // Custom numeric fallback
      expect(calculateFuelEfficiency(null, 25, 4.2)).toBe(4.2);
      expect(calculateFuelEfficiency(-5, 25, 3)).toBe(3);

      // Custom options object fallback
      expect(calculateFuelEfficiency(100, null, { fallback: 5.5 })).toBe(5.5);
    });

    it('throws DomainError when throwOnError is true', () => {
      expect(() => calculateFuelEfficiency(null, 25, { throwOnError: true })).toThrow(DomainError);
      expect(() => calculateFuelEfficiency(100, null, { throwOnError: true })).toThrow(DomainError);
      expect(() => calculateFuelEfficiency(-10, 25, { throwOnError: true })).toThrow(DomainError);
      expect(() => calculateFuelEfficiency(100, 0, { throwOnError: true })).toThrow(DomainError);
      expect(() => calculateFuelEfficiency(100, -5, { throwOnError: true })).toThrow(DomainError);
      expect(() => calculateFuelEfficiency('abc', 25, { throwOnError: true })).toThrow(DomainError);
      expect(() => calculateFuelEfficiency(100, 'abc', { throwOnError: true })).toThrow(DomainError);
    });

    it('exposes calculateFuelEfficiency on service instance and as static method', () => {
      const { service } = makeService();
      expect(service.calculateFuelEfficiency(100, 20)).toBe(5);
      expect(FuelAdvisorService.calculateFuelEfficiency(100, 20)).toBe(5);
    });
  });

  describe('constructor', () => {
    it('initializes with default efficiency and provided dependencies', () => {
      const logger = makeLogger();
      const weatherService = { getWeatherForecast: vi.fn() };
      const supabase = makeChain({ data: null, error: null });

      const service = new FuelAdvisorService({
        supabase,
        weatherService,
        logger,
      });

      expect(service.supabase).toBe(supabase);
      expect(service.weatherService).toBe(weatherService);
      expect(service.logger).toBe(logger);
      expect(service.fuelEfficiency).toEqual({
        truck: 3.5,
        van: 8,
        car: 12,
      });
      expect(service.fuelPrices).toEqual({});
    });

    it('allows custom fuel efficiency and prices overrides in constructor', () => {
      const { service } = makeService({
        fuelPrices: { truck: 105, custom: 85 },
        fuelEfficiency: { truck: 4.0, custom: 15 },
      });

      expect(service.fuelEfficiency.truck).toBe(4.0);
      expect(service.fuelEfficiency.custom).toBe(15);
      expect(service.fuelPrices.truck).toBe(105);
      expect(service.fuelPrices.custom).toBe(85);
    });
  });

  describe('estimateFuelCost (tripFuelEstimate)', () => {
    it('estimates fuel consumption and cost accurately for truck, van, and car', () => {
      const { service } = makeService();

      const truckResult = service.tripFuelEstimate(350, 'truck', 100);
      expect(truckResult).toEqual({
        success: true,
        distanceKm: 350,
        vehicleType: 'truck',
        fuelEfficiencyKmPerLitre: 3.5,
        fuelUsedLitres: 100,
        fuelPricePerLitre: 100,
        fuelCost: 10000,
      });

      const vanResult = service.tripFuelEstimate(80, 'van', 90);
      expect(vanResult.success).toBe(true);
      expect(vanResult.fuelUsedLitres).toBe(10);
      expect(vanResult.fuelCost).toBe(900);

      const carResult = service.tripFuelEstimate(60, 'car', 95);
      expect(carResult.success).toBe(true);
      expect(carResult.fuelUsedLitres).toBe(5);
      expect(carResult.fuelCost).toBe(475);
    });

    it('uses configured vehicle price when fuelPricePerLitre parameter is omitted', () => {
      const { service } = makeService();
      const result = service.tripFuelEstimate(70, 'truck');

      expect(result.success).toBe(true);
      expect(result.fuelPricePerLitre).toBe(100);
      expect(result.fuelCost).toBe(2000);
    });

    it('falls back to default price when vehicle type has no explicit price entry', () => {
      const { service } = makeService({
        fuelPrices: { default: 80 },
        fuelEfficiency: { special: 10 },
      });

      const result = service.tripFuelEstimate(50, 'special');
      expect(result.success).toBe(true);
      expect(result.fuelPricePerLitre).toBe(80);
      expect(result.fuelCost).toBe(400);
    });

    it('normalizes case for vehicleType', () => {
      const { service } = makeService();
      const result = service.tripFuelEstimate(70, 'TRUCK', 100);

      expect(result.success).toBe(true);
      expect(result.vehicleType).toBe('truck');
      expect(result.fuelCost).toBe(2000);
    });

    it('supports 0 distance with 0 cost', () => {
      const { service } = makeService();
      const result = service.tripFuelEstimate(0, 'truck', 100);

      expect(result.success).toBe(true);
      expect(result.distanceKm).toBe(0);
      expect(result.fuelUsedLitres).toBe(0);
      expect(result.fuelCost).toBe(0);
    });

    it('supports numeric strings for distance and price', () => {
      const { service } = makeService();
      const result = service.tripFuelEstimate('140', 'truck', '100');

      expect(result.success).toBe(true);
      expect(result.distanceKm).toBe(140);
      expect(result.fuelPricePerLitre).toBe(100);
      expect(result.fuelCost).toBe(4000);
    });

    it('returns error and logs debug for invalid distance', () => {
      const { service, logger } = makeService();

      const invalidDistances = [null, undefined, -10, NaN, Infinity, 'abc'];
      for (const dist of invalidDistances) {
        const result = service.tripFuelEstimate(dist, 'truck', 100);
        expect(result).toEqual({
          success: false,
          error: 'distanceKm must be a non-negative finite number',
        });
      }
      expect(logger.debug).toHaveBeenCalledWith('[FuelAdvisorService] Invalid trip distance supplied');
    });

    it('returns error and logs debug for unsupported vehicle type', () => {
      const { service, logger } = makeService();

      const invalidTypes = [null, undefined, '', 'plane', 'boat'];
      for (const type of invalidTypes) {
        const result = service.tripFuelEstimate(100, type, 100);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Unsupported vehicle type');
      }
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Unsupported vehicle type'));
    });

    it('returns error and logs debug when fuel price is invalid or unavailable', () => {
      const { service, logger } = makeService({ fuelPrices: {} });

      const invalidPrices = [null, undefined, -5, NaN, Infinity, 'invalid'];
      for (const price of invalidPrices) {
        const result = service.tripFuelEstimate(100, 'truck', price);
        expect(result).toEqual({
          success: false,
          error: 'fuelPricePerLitre must be a finite non-negative number',
        });
      }
      expect(logger.debug).toHaveBeenCalledWith('[FuelAdvisorService] Fuel price is unavailable');
    });

    it('allows a 0 fuel price without producing NaN', () => {
      const { service } = makeService();
      const result = service.tripFuelEstimate(100, 'truck', 0);

      expect(result.success).toBe(true);
      expect(result.fuelCost).toBe(0);
    });
  });

  describe('optimizeRoute / routeFuelEstimate', () => {
    it('returns zero totals for empty legs array', () => {
      const { service } = makeService();
      const result = service.routeFuelEstimate([], 'truck', 100);

      expect(result).toEqual({
        success: true,
        legs: 0,
        distanceKm: 0,
        fuelUsedLitres: 0,
        fuelCost: 0,
        vehicleType: 'truck',
      });
    });

    it('aggregates multiple legs with distanceKm objects', () => {
      const { service, logger } = makeService();
      const legs = [{ distanceKm: 35 }, { distanceKm: 70 }, { distanceKm: 105 }];

      const result = service.routeFuelEstimate(legs, 'truck', 100);

      expect(result.success).toBe(true);
      expect(result.legs).toBe(3);
      expect(result.distanceKm).toBe(210);
      expect(result.fuelUsedLitres).toBe(60);
      expect(result.fuelCost).toBe(6000);
      expect(result.estimates).toHaveLength(3);
      expect(logger.info).toHaveBeenCalledWith(
        '[FuelAdvisorService] Route fuel estimate calculated',
        result,
      );
    });

    it('accepts array of numeric numbers as legs', () => {
      const { service } = makeService();
      const result = service.routeFuelEstimate([16, 24, 40], 'van', 90);

      expect(result.success).toBe(true);
      expect(result.legs).toBe(3);
      expect(result.distanceKm).toBe(80);
      expect(result.fuelUsedLitres).toBe(10);
      expect(result.fuelCost).toBe(900);
    });

    it('accepts distance and distance_km property names in leg objects', () => {
      const { service } = makeService();
      const legs = [{ distance: 24 }, { distance_km: 36 }];

      const result = service.routeFuelEstimate(legs, 'car', 100);

      expect(result.success).toBe(true);
      expect(result.distanceKm).toBe(60);
      expect(result.fuelUsedLitres).toBe(5);
      expect(result.fuelCost).toBe(500);
    });

    it('supports per-leg fuel price overrides', () => {
      const { service } = makeService();
      const legs = [
        { distanceKm: 35, fuelPricePerLitre: 80 },
        { distanceKm: 70, fuelPricePerLitre: 120 },
      ];

      const result = service.routeFuelEstimate(legs, 'truck');

      expect(result.success).toBe(true);
      expect(result.estimates[0].fuelCost).toBe(800);
      expect(result.estimates[1].fuelCost).toBe(2400);
      expect(result.fuelCost).toBe(3200);
    });

    it('returns error when legs is not an array', () => {
      const { service, logger } = makeService();

      const invalidLegs = [null, undefined, {}, 'not-an-array', 123];
      for (const legs of invalidLegs) {
        const result = service.routeFuelEstimate(legs, 'truck', 100);
        expect(result).toEqual({ success: false, error: 'legs must be an array' });
      }
      expect(logger.debug).toHaveBeenCalledWith('[FuelAdvisorService] Invalid route legs supplied');
    });

    it('returns first failure and stops when a leg is invalid', () => {
      const { service } = makeService();
      const legs = [{ distanceKm: 35 }, { distanceKm: -10 }, { distanceKm: 70 }];

      const result = service.routeFuelEstimate(legs, 'truck', 100);

      expect(result).toEqual({
        success: false,
        error: 'distanceKm must be a non-negative finite number',
        legIndex: 1,
      });
    });

    it('returns error when a leg is null or missing distance', () => {
      const { service } = makeService();

      const resultNull = service.routeFuelEstimate([null], 'truck', 100);
      expect(resultNull.success).toBe(false);
      expect(resultNull.legIndex).toBe(0);

      const resultMissing = service.routeFuelEstimate([{ name: 'waypoint' }], 'truck', 100);
      expect(resultMissing.success).toBe(false);
      expect(resultMissing.error).toBe('distanceKm must be a non-negative finite number');
    });
  });

  describe('getFuelRecommendation - Weather Service & Null Guard', () => {
    it('recommends B20 with LOW risk when weather is warm (> 0C)', async () => {
      const weatherService = {
        getWeatherForecast: vi.fn().mockResolvedValue({ temperature_c: 25, condition: 'Clear' }),
      };
      const { service } = makeService({ weatherService });
      vi.spyOn(service, '_getAverageEngineLoad').mockResolvedValue(50);

      const result = await service.getFuelRecommendation('truck-1', 28.6139, 77.2090);

      expect(result.recommended_blend).toBe('B20');
      expect(result.risk_level).toBe('LOW');
      expect(result.reasoning).toContain('Weather is warm enough for B20 Biodiesel');
      expect(result.factors.average_engine_load_percent).toBe(50);
      expect(result.factors.weather_forecast).toEqual({ temperature_c: 25, condition: 'Clear' });
    });

    it('recommends B5 with HIGH risk when temp <= 0C and avg load < 60%', async () => {
      const weatherService = {
        getWeatherForecast: vi.fn().mockResolvedValue({ temperature_c: -5, condition: 'Snow' }),
      };
      const { service } = makeService({ weatherService });
      vi.spyOn(service, '_getAverageEngineLoad').mockResolvedValue(45);

      const result = await service.getFuelRecommendation('truck-2', 34.0837, 74.7973);

      expect(result.recommended_blend).toBe('B5');
      expect(result.risk_level).toBe('HIGH');
      expect(result.reasoning).toContain('Sub-zero temperatures expected and recent engine load is low');
      expect(result.factors.average_engine_load_percent).toBe(45);
    });

    it('recommends B20 with MEDIUM risk when temp <= 0C and avg load >= 60%', async () => {
      const weatherService = {
        getWeatherForecast: vi.fn().mockResolvedValue({ temperature_c: 0, condition: 'Freezing' }),
      };
      const { service } = makeService({ weatherService });
      vi.spyOn(service, '_getAverageEngineLoad').mockResolvedValue(70);

      const result = await service.getFuelRecommendation('truck-3', 34.0837, 74.7973);

      expect(result.recommended_blend).toBe('B20');
      expect(result.risk_level).toBe('MEDIUM');
      expect(result.reasoning).toContain('high average engine load will maintain sufficient heat');
      expect(result.factors.average_engine_load_percent).toBe(70);
    });

    it('guards against null weatherService response and falls back to B20 LOW risk', async () => {
      const weatherService = {
        getWeatherForecast: vi.fn().mockResolvedValue(null),
      };
      const { service, logger } = makeService({ weatherService });
      vi.spyOn(service, '_getAverageEngineLoad').mockResolvedValue(55);

      const result = await service.getFuelRecommendation('truck-4', 28.6139, 77.2090);

      expect(result.recommended_blend).toBe('B20');
      expect(result.risk_level).toBe('LOW');
      expect(result.reasoning).toContain('Weather forecast unavailable');
      expect(result.factors.weather_forecast).toBeNull();
      expect(result.factors.average_engine_load_percent).toBe(55);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Weather service unavailable or returned invalid data — using safe default B20.'),
      );
    });

    it('guards against non-finite or NaN weather temperature_c and falls back to B20 LOW risk', async () => {
      const weatherService = {
        getWeatherForecast: vi.fn().mockResolvedValue({ temperature_c: NaN }),
      };
      const { service, logger } = makeService({ weatherService });
      vi.spyOn(service, '_getAverageEngineLoad').mockResolvedValue(50);

      const result = await service.getFuelRecommendation('truck-5', 28.6139, 77.2090);

      expect(result.recommended_blend).toBe('B20');
      expect(result.risk_level).toBe('LOW');
      expect(result.reasoning).toContain('Weather forecast unavailable');
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('_getAverageEngineLoad', () => {
    it('calculates average engine load from telemetry gpsUpdate events', async () => {
      const mockEvents = [
        { metadata: { engineLoad: 60 } },
        { metadata: { engineLoad: 80 } },
        { metadata: { engineLoad: null } },
        { metadata: {} },
      ];

      const supabase = {
        from: vi.fn((table) => {
          if (table === 'orders') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'order-123' }, error: null }),
            };
          }
          if (table === 'trips') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'trip-123' }, error: null }),
            };
          }
          if (table === 'trip_events') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: mockEvents, error: null }),
            };
          }
          return makeChain({ data: null, error: null });
        }),
      };

      const { service } = makeService({ supabase });
      const load = await service._getAverageEngineLoad('truck-1');

      expect(load).toBe(70); // (60 + 80) / 2
    });

    it('returns default 50 when no active order is found', async () => {
      const supabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      };

      const { service, logger } = makeService({ supabase });
      const load = await service._getAverageEngineLoad('truck-unknown');

      expect(load).toBe(50);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('No active order found'));
    });

    it('returns default 50 when order lookup has an error', async () => {
      const supabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
        })),
      };

      const { service } = makeService({ supabase });
      const load = await service._getAverageEngineLoad('truck-1');

      expect(load).toBe(50);
    });

    it('returns default 50 when order exists but trip does not', async () => {
      const supabase = {
        from: vi.fn((table) => {
          if (table === 'orders') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
            };
          }
          if (table === 'trips') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          return makeChain({ data: null, error: null });
        }),
      };

      const { service, logger } = makeService({ supabase });
      const load = await service._getAverageEngineLoad('truck-1');

      expect(load).toBe(50);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('No trip found'));
    });

    it('returns default 50 when trip events list is empty or fails', async () => {
      const supabase = {
        from: vi.fn((table) => {
          if (table === 'orders') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
            };
          }
          if (table === 'trips') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'trip-1' }, error: null }),
            };
          }
          if (table === 'trip_events') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }
          return makeChain({ data: null, error: null });
        }),
      };

      const { service } = makeService({ supabase });
      const load = await service._getAverageEngineLoad('truck-1');

      expect(load).toBe(50);
    });

    it('catches and logs errors gracefully and returns fallback 50', async () => {
      const supabase = {
        from: vi.fn(() => {
          throw new Error('Supabase client crash');
        }),
      };

      const { service, logger } = makeService({ supabase });
      const load = await service._getAverageEngineLoad('truck-1');

      expect(load).toBe(50);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error computing engine load: Supabase client crash'),
      );
    });
  });
});
