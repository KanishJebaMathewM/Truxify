import { describe, it, expect, vi } from 'vitest';
import { WeatherService } from '../../src/services/weatherService.js';

describe('WeatherService', () => {
  let service;

  beforeEach(() => {
    service = new WeatherService({ logger: { debug: () => {} } });
  });

  describe('getWeatherForecast', () => {
    it('returns warm weather for latitudes at or below 40', async () => {
      const result = await service.getWeatherForecast(19.07, 72.87);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
      expect(result.forecast_time).toBeDefined();
    });

    it('returns snow for latitudes above 40', async () => {
      const result = await service.getWeatherForecast(45, 10);
      expect(result.temperature_c).toBe(-5);
      expect(result.condition).toBe('snow');
    });

    it('returns snow for latitudes below -40', async () => {
      const result = await service.getWeatherForecast(-50, 10);
      expect(result.temperature_c).toBe(-5);
      expect(result.condition).toBe('snow');
    });

    it('returns warm for latitude exactly 40', async () => {
      const result = await service.getWeatherForecast(40, 0);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('returns warm for latitude exactly -40', async () => {
      const result = await service.getWeatherForecast(-40, 0);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('treats NaN latitude as warm default', async () => {
      const result = await service.getWeatherForecast('not-a-number', 0);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('treats string numeric latitude correctly', async () => {
      const result = await service.getWeatherForecast('50', 0);
      expect(result.temperature_c).toBe(-5);
      expect(result.condition).toBe('snow');
    });

    it('returns an ISO-8601 forecast time', async () => {
      const result = await service.getWeatherForecast(19.07, 72.87);
      expect(new Date(result.forecast_time).toISOString()).toBe(result.forecast_time);
    });

    it('invokes the injected logger with the coordinates', async () => {
      const debug = vi.fn();
      const svc = new WeatherService({ logger: { debug } });
      await svc.getWeatherForecast(19.07, 72.87);
      expect(debug).toHaveBeenCalledWith(
        '[WeatherService] Fetching forecast for lat: 19.07, lng: 72.87'
      );
    });

    it('works without an injected logger', async () => {
      const svc = new WeatherService({});
      const result = await svc.getWeatherForecast(45, 10);
      expect(result.condition).toBe('snow');
    });
  });
});
