```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeatherService } from '../../src/services/weatherService.js';

describe('WeatherService', () => {
  let service;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    service = new WeatherService({ logger: mockLogger });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getWeatherForecast', () => {
    describe('cold temperature branch', () => {
      it('returns -5C and snow when latitude is greater than 40', async () => {
        const result = await service.getWeatherForecast(45, 72);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });

      it('returns -5C and snow when latitude is less than -40', async () => {
        const result = await service.getWeatherForecast(-45, 72);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });

      it('returns cold weather for latitude 41', async () => {
        const result = await service.getWeatherForecast(41, 72);

        expect(result.temperature_c).toEqual(-5);
        expect(result.condition).toEqual('snow');
      });

      it('returns cold weather for latitude -41', async () => {
        const result = await service.getWeatherForecast(-41, 72);

        expect(result.temperature_c).toEqual(-5);
        expect(result.condition).toEqual('snow');
      });

      it('returns cold weather for the maximum northern latitude', async () => {
        const result = await service.getWeatherForecast(90, 0);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });

      it('returns cold weather for the minimum southern latitude', async () => {
        const result = await service.getWeatherForecast(-90, 0);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });
    });

    describe('warm temperature branch', () => {
      it('returns 15C and clear when latitude is between -40 and 40', async () => {
        const result = await service.getWeatherForecast(20, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm weather at latitude 0', async () => {
        const result = await service.getWeatherForecast(0, 0);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm weather at latitude 40', async () => {
        const result = await service.getWeatherForecast(40, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm weather at latitude -40', async () => {
        const result = await service.getWeatherForecast(-40, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm weather just below latitude 40', async () => {
        const result = await service.getWeatherForecast(39.999999, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm weather just above latitude -40', async () => {
        const result = await service.getWeatherForecast(-39.999999, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });
    });

    describe('non-finite latitude values', () => {
      it('returns warm default for NaN latitude', async () => {
        const result = await service.getWeatherForecast(NaN, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm default for positive Infinity latitude', async () => {
        const result = await service.getWeatherForecast(Infinity, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm default for negative Infinity latitude', async () => {
        const result = await service.getWeatherForecast(-Infinity, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm default for a non-numeric latitude', async () => {
        const result = await service.getWeatherForecast('invalid', 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm default for undefined latitude', async () => {
        const result = await service.getWeatherForecast(undefined, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });
    });

    describe('non-finite longitude values', () => {
      it('returns warm default when longitude is NaN', async () => {
        const result = await service.getWeatherForecast(45, NaN);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm default when longitude is positive Infinity', async () => {
        const result = await service.getWeatherForecast(45, Infinity);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm default when longitude is negative Infinity', async () => {
        const result = await service.getWeatherForecast(45, -Infinity);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm default when longitude is non-numeric', async () => {
        const result = await service.getWeatherForecast(45, 'invalid');

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm default when longitude is undefined', async () => {
        const result = await service.getWeatherForecast(45, undefined);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });
    });

    describe('coordinate conversion', () => {
      it('accepts numeric latitude and longitude strings', async () => {
        const result = await service.getWeatherForecast('25', '72');

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('converts a numeric latitude string above 40 to cold weather', async () => {
        const result = await service.getWeatherForecast('45', '72');

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });

      it('converts a numeric latitude string below -40 to cold weather', async () => {
        const result = await service.getWeatherForecast('-45', '72');

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });
    });

    describe('logger interaction', () => {
      it('calls logger.debug once for a weather request', async () => {
        await service.getWeatherForecast(30, 72);

        expect(mockLogger.debug).toHaveBeenCalledTimes(1);
      });

      it('logs the latitude and longitude values', async () => {
        await service.getWeatherForecast(30, 72);

        expect(mockLogger.debug).toHaveBeenCalledWith(
          '[WeatherService] Fetching forecast for lat: 30, lng: 72'
        );
      });

      it('logs negative coordinates correctly', async () => {
        await service.getWeatherForecast(-45, -90);

        expect(mockLogger.debug).toHaveBeenCalledWith(
          '[WeatherService] Fetching forecast for lat: -45, lng: -90'
        );
      });

      it('logs string coordinates using their original values', async () => {
        await service.getWeatherForecast('45', '72');

        expect(mockLogger.debug).toHaveBeenCalledWith(
          '[WeatherService] Fetching forecast for lat: 45, lng: 72'
        );
      });

      it('logs non-finite coordinate values', async () => {
        await service.getWeatherForecast(NaN, Infinity);

        expect(mockLogger.debug).toHaveBeenCalledWith(
          '[WeatherService] Fetching forecast for lat: NaN, lng: Infinity'
        );
      });

      it('does not call info, warn, or error for a normal request', async () => {
        await service.getWeatherForecast(30, 72);

        expect(mockLogger.info).not.toHaveBeenCalled();
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
      });

      it('works without a logger', async () => {
        const instance = new WeatherService({});

        const result = await instance.getWeatherForecast(30, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('works with an explicitly undefined logger', async () => {
        const instance = new WeatherService({ logger: undefined });

        const result = await instance.getWeatherForecast(30, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });
    });

    describe('response structure', () => {
      it('returns the expected response properties', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result).toHaveProperty('temperature_c');
        expect(result).toHaveProperty('condition');
        expect(result).toHaveProperty('forecast_time');
      });

      it('returns exactly three response properties', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(Object.keys(result).sort()).toEqual([
          'condition',
          'forecast_time',
          'temperature_c',
        ]);
      });

      it('returns temperature_c as a number', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result.temperature_c).toBeTypeOf('number');
      });

      it('returns condition as a string', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result.condition).toBeTypeOf('string');
      });

      it('returns forecast_time as a string', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result.forecast_time).toBeTypeOf('string');
      });

      it('returns forecast_time in ISO format', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result.forecast_time).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
        );
      });

      it('returns a parseable forecast_time', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(Number.isNaN(Date.parse(result.forecast_time))).toBe(false);
      });

      it('returns a complete cold weather response', async () => {
        const result = await service.getWeatherForecast(50, 10);

        expect(result).toEqual(
          expect.objectContaining({
            temperature_c: -5,
            condition: 'snow',
          })
        );

        expect(result.forecast_time).toBeDefined();
      });

      it('returns a complete warm weather response', async () => {
        const result = await service.getWeatherForecast(10, 10);

        expect(result).toEqual(
          expect.objectContaining({
            temperature_c: 15,
            condition: 'clear',
          })
        );

        expect(result.forecast_time).toBeDefined();
      });
    });

    describe('repeated requests', () => {
      it('returns consistent weather values for repeated warm requests', async () => {
        const first = await service.getWeatherForecast(20, 72);
        const second = await service.getWeatherForecast(20, 72);

        expect(first.temperature_c).toBe(second.temperature_c);
        expect(first.condition).toBe(second.condition);
      });

      it('returns consistent weather values for repeated cold requests', async () => {
        const first = await service.getWeatherForecast(60, 72);
        const second = await service.getWeatherForecast(60, 72);

        expect(first.temperature_c).toBe(second.temperature_c);
        expect(first.condition).toBe(second.condition);
      });

      it('returns a new response object for each request', async () => {
        const first = await service.getWeatherForecast(30, 72);
        const second = await service.getWeatherForecast(30, 72);

        expect(first).not.toBe(second);
      });

      it('does not use longitude to determine temperature when coordinates are valid', async () => {
        const first = await service.getWeatherForecast(30, -180);
        const second = await service.getWeatherForecast(30, 180);

        expect(first.temperature_c).toBe(15);
        expect(second.temperature_c).toBe(15);
        expect(first.condition).toBe('clear');
        expect(second.condition).toBe('clear');
      });
    });
  });
});
```
