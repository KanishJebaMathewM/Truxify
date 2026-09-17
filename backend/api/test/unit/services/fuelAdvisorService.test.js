import { describe, it, expect, vi } from 'vitest';

const { FuelAdvisorService } = await import('../../../../src/services/fuelAdvisorService.js');

// Build a chainable supabase mock: all intermediate methods return the chain,
// the terminal maybeSingle() returns a Promise resolving to the given data.
function makeChain(terminalData) {
  const chain = {
    from: () => chain,
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    eq: () => chain,
    in: () => chain,
    maybeSingle: () => Promise.resolve(terminalData),
  };
  return chain;
}

describe('FuelAdvisorService', () => {
  describe('constructor', () => {
    it('assigns all injected dependencies', () => {
      const mockSupabase = makeChain({ data: null, error: null });
      const mockWeather = { getWeatherForecast: vi.fn() };
      const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const svc = new FuelAdvisorService({
        supabase: mockSupabase,
        weatherService: mockWeather,
        logger: mockLogger,
      });
      expect(svc.supabase).toBe(mockSupabase);
      expect(svc.weatherService).toBe(mockWeather);
      expect(svc.logger).toBe(mockLogger);
    });
  });

  describe('getFuelRecommendation', () => {
    const makeSvc = (avgLoad, weatherData) => {
      const chain = makeChain({
        data: [{ average_engine_load: avgLoad, recorded_at: '2025-07-25T10:00:00Z' }],
        error: null,
      });
      const weather = { getWeatherForecast: vi.fn().mockResolvedValue(weatherData) };
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      return { svc: new FuelAdvisorService({ supabase: chain, weatherService: weather, logger }), weather };
    };

    it('recommends B20 with LOW risk when weather is warm and load is high', async () => {
      const { svc } = makeSvc(75, { temperature_c: 20 });
      const result = await svc.getFuelRecommendation('truck-1', 28.6139, 77.2090);
      expect(result.recommended_blend).toBe('B20');
      expect(result.risk_level).toBe('LOW');
    });

    it('recommends B20 with LOW risk when weather is warm regardless of load', async () => {
      const { svc } = makeSvc(50, { temperature_c: 15 });
      const result = await svc.getFuelRecommendation('truck-2', 28.6139, 77.2090);
      expect(result.recommended_blend).toBe('B20');
      expect(result.risk_level).toBe('LOW');
    });

    it('recommends B5 with HIGH risk when temp <= 0C and load < 60%', async () => {
      const { svc } = makeSvc(45, { temperature_c: -5 });
      const result = await svc.getFuelRecommendation('truck-3', 28.6139, 77.2090);
      expect(result.recommended_blend).toBe('B5');
      expect(result.risk_level).toBe('HIGH');
    });

    it('falls back to B20 LOW when weather service returns null', async () => {
      const { svc } = makeSvc(50, null);
      const result = await svc.getFuelRecommendation('truck-5', 28.6139, 77.2090);
      expect(result.recommended_blend).toBe('B20');
      expect(result.risk_level).toBe('LOW');
    });

    it('falls back to B20 LOW when weather temperature is not finite', async () => {
      const { svc } = makeSvc(50, { temperature_c: NaN });
      const result = await svc.getFuelRecommendation('truck-6', 28.6139, 77.2090);
      expect(result.recommended_blend).toBe('B20');
      expect(result.risk_level).toBe('LOW');
    });

    it('includes weather_forecast factor when available', async () => {
      const weatherData = { temperature_c: 10 };
      const { svc } = makeSvc(65, weatherData);
      const result = await svc.getFuelRecommendation('truck-9', 28.6139, 77.2090);
      expect(result.factors.weather_forecast).toEqual(weatherData);
    });
  });
});
