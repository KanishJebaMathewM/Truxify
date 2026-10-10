import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeatherService } from '../../../src/services/weatherService.js';

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('WeatherService', () => {
  let weatherService;

  beforeEach(() => {
    vi.clearAllMocks();
    weatherService = new WeatherService({ logger: mockLogger });
  });

  describe('getWeatherForecast (mock forecast contract)', () => {
    it('returns the warm default for in-band latitudes', async () => {
      // Chennai sits inside the +/-40 band, so the mock forecast is warm.
      const result = await weatherService.getWeatherForecast(13.0827, 80.2707);
      expect(result.condition).toBe('clear');
      expect(result.temperature_c).toBe(15);
      expect(result.forecast_time).toEqual(expect.any(String));
    });

    it('returns snow below -5 degrees for high and low latitudes', async () => {
      const north = await weatherService.getWeatherForecast(55.0, 37.0);
      expect(north.temperature_c).toBe(-5);
      expect(north.condition).toBe('snow');

      const south = await weatherService.getWeatherForecast(-55.0, 77.0);
      expect(south.temperature_c).toBe(-5);
      expect(south.condition).toBe('snow');
    });

    it('falls back to the warm default instead of snow on non-finite coordinates', async () => {
      // NaN comparisons are always false, so the guard must catch bad input
      // explicitly rather than silently matching the snow band.
      const result = await weatherService.getWeatherForecast('abc', 80.2707);
      expect(result.condition).toBe('clear');
      expect(result.temperature_c).toBe(15);
    });

    it('treats numeric strings as coordinates', async () => {
      const result = await weatherService.getWeatherForecast('55', '37');
      expect(result.temperature_c).toBe(-5);
      expect(result.condition).toBe('snow');
    });
  });
});
