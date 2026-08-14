import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

import { FuelAdvisorService } from '../../src/services/fuelAdvisorService.js';

describe('FuelAdvisorService', () => {
  let weatherService;
  let service;

  beforeEach(() => {
    vi.clearAllMocks();
    weatherService = {
      getWeatherForecast: vi.fn(),
    };
    service = new FuelAdvisorService({
      supabase: {},
      weatherService,
      logger: mockLogger,
    });
  });

  describe('getFuelRecommendation', () => {
    it('recommends B5 for sub-zero temps and low engine load', async () => {
      weatherService.getWeatherForecast.mockResolvedValue({ temperature_c: -5 });
      vi.spyOn(service, '_getAverageEngineLoad').mockResolvedValue(40);

      const result = await service.getFuelRecommendation('truck-1', 45, 10);
      expect(result.recommended_blend).toBe('B5');
      expect(result.risk_level).toBe('HIGH');
      expect(result.factors.average_engine_load_percent).toBe(40);
    });

    it('recommends B20 for sub-zero temps and high engine load', async () => {
      weatherService.getWeatherForecast.mockResolvedValue({ temperature_c: -5 });
      vi.spyOn(service, '_getAverageEngineLoad').mockResolvedValue(80);

      const result = await service.getFuelRecommendation('truck-1', 45, 10);
      expect(result.recommended_blend).toBe('B20');
      expect(result.risk_level).toBe('MEDIUM');
    });

    it('recommends B20 for warm temps regardless of load', async () => {
      weatherService.getWeatherForecast.mockResolvedValue({ temperature_c: 25 });
      vi.spyOn(service, '_getAverageEngineLoad').mockResolvedValue(40);

      const result = await service.getFuelRecommendation('truck-1', 19, 72);
      expect(result.recommended_blend).toBe('B20');
      expect(result.risk_level).toBe('LOW');
    });

    it('passes destination coordinates to the weather service', async () => {
      weatherService.getWeatherForecast.mockResolvedValue({ temperature_c: 25 });
      vi.spyOn(service, '_getAverageEngineLoad').mockResolvedValue(50);
      await service.getFuelRecommendation('truck-1', 19.07, 72.87);
      expect(weatherService.getWeatherForecast).toHaveBeenCalledWith(19.07, 72.87);
    });
  });

  describe('_getAverageEngineLoad', () => {
    it('returns 50 when no active order is found', async () => {
      service.supabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  })),
                })),
              })),
            })),
          })),
        })),
      };
      const load = await service._getAverageEngineLoad('truck-1');
      expect(load).toBe(50);
    });

    it('returns 50 when the query errors', async () => {
      service.supabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
                  })),
                })),
              })),
            })),
          })),
        })),
      };
      const load = await service._getAverageEngineLoad('truck-1');
      expect(load).toBe(50);
    });
  });
});
