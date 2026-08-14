import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FuelAdvisorService } from '../../src/services/fuelAdvisorService.js';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: 'no order' }),
              })),
            })),
          })),
        })),
      })),
    })),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return dbMock; },
}));

describe('fuelAdvisorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default B20 when weather service is unavailable', async () => {
    const mockWeatherService = { getWeatherForecast: vi.fn().mockResolvedValue(null) };
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const service = new FuelAdvisorService({
      supabase: { from: () => ({ select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) }) }) }) }) },
      weatherService: mockWeatherService,
      logger: mockLogger,
    });
    const result = await service.getFuelRecommendation('truck-1', 12.97, 77.59);
    expect(result.recommended_blend).toBe('B20');
    expect(result.risk_level).toBe('LOW');
  });

  it('returns default B20 when weather temperature is not finite', async () => {
    const mockWeatherService = { getWeatherForecast: vi.fn().mockResolvedValue({ temperature_c: null }) };
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const service = new FuelAdvisorService({
      supabase: { from: () => ({ select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) }) }) }) }) },
      weatherService: mockWeatherService,
      logger: mockLogger,
    });
    const result = await service.getFuelRecommendation('truck-1', 12.97, 77.59);
    expect(result.recommended_blend).toBe('B20');
  });

  it('returns B20 for warm weather (temp > 0)', async () => {
    const mockWeatherService = { getWeatherForecast: vi.fn().mockResolvedValue({ temperature_c: 25 }) };
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const service = new FuelAdvisorService({
      supabase: { from: () => ({ select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) }) }) }) }) },
      weatherService: mockWeatherService,
      logger: mockLogger,
    });
    const result = await service.getFuelRecommendation('truck-1', 12.97, 77.59);
    expect(result.recommended_blend).toBe('B20');
    expect(result.risk_level).toBe('LOW');
  });

  it('returns B5 for freezing temp and low engine load', async () => {
    const mockWeatherService = { getWeatherForecast: vi.fn().mockResolvedValue({ temperature_c: -5 }) };
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const service = new FuelAdvisorService({
      supabase: { from: () => ({ select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }) }) }) }) }) }) }) },
      weatherService: mockWeatherService,
      logger: mockLogger,
    });
    const result = await service.getFuelRecommendation('truck-1', 12.97, 77.59);
    expect(result.recommended_blend).toBe('B5');
    expect(result.risk_level).toBe('HIGH');
  });

  it('returns B20 for freezing temp when engine load data is unavailable (defaults to 50)', async () => {
    const mockWeatherService = { getWeatherForecast: vi.fn().mockResolvedValue({ temperature_c: -5 }) };
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const service = new FuelAdvisorService({
      supabase: { from: () => ({ select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) }) }) }) }) },
      weatherService: mockWeatherService,
      logger: mockLogger,
    });
    const result = await service.getFuelRecommendation('truck-1', 12.97, 77.59);
    // No engine load data -> defaults to 50% load -> still < 60 -> B5
    expect(result.recommended_blend).toBe('B5');
    expect(result.risk_level).toBe('HIGH');
  });
});
