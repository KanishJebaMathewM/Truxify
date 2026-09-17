import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WeatherService } from '../../src/services/weatherService.js';

describe('WeatherService', () => {
  let service;
  let mockLogger;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    service = new WeatherService({ logger: mockLogger });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getWeatherForecast', () => {
    it('returns warm weather for lat <= 40', async () => {
      const result = await service.getWeatherForecast(30, 72);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('returns warm weather for negative lat (southern hemisphere, above -40)', async () => {
      const result = await service.getWeatherForecast(-30, 72);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('returns cold/snow weather for lat > 40', async () => {
      const result = await service.getWeatherForecast(45, 72);
      expect(result.temperature_c).toBe(-5);
      expect(result.condition).toBe('snow');
    });

    it('returns cold/snow weather for lat < -40', async () => {
      const result = await service.getWeatherForecast(-50, 72);
      expect(result.temperature_c).toBe(-5);
      expect(result.condition).toBe('snow');
    });

    it('returns warm weather for boundary lat = 40', async () => {
      const result = await service.getWeatherForecast(40, 72);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('returns warm weather for boundary lat = -40', async () => {
      const result = await service.getWeatherForecast(-40, 72);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('returns warm weather for string numeric coordinates', async () => {
      const result = await service.getWeatherForecast('25', '80');
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('returns warm weather for invalid/non-numeric lat', async () => {
      const result = await service.getWeatherForecast(NaN, 72);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('returns warm weather for undefined lat', async () => {
      const result = await service.getWeatherForecast(undefined, 72);
      expect(result.temperature_c).toBe(15);
    });

    it('includes forecast_time in ISO format', async () => {
      vi.advanceTimersByTime(1000);
      const result = await service.getWeatherForecast(30, 72);
      expect(typeof result.forecast_time).toBe('string');
      expect(result.forecast_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('logs debug message with coordinates', async () => {
      await service.getWeatherForecast(30, 72);
      expect(mockLogger.debug).toHaveBeenCalledWith('[WeatherService] Fetching forecast for lat: 30, lng: 72');
    });

    it('handles service without logger', async () => {
      const s2 = new WeatherService({});
      const result = await s2.getWeatherForecast(30, 72);
      expect(result.temperature_c).toBe(15);
    });
  });
});
