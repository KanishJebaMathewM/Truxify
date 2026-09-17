import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WeatherService,
  checkSevereWeatherAdvisory,
  calculateWeatherFuelPenalty,
  getMeteorologicalRegion,
  WeatherAdvisorUtilities
} from '../../src/services/weatherService.js';

describe('WeatherService & Fleet Weather Advisor Comprehensive Suite (Issue #14109)', () => {
  let weatherService;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    weatherService = new WeatherService({ logger: mockLogger });
  });

  describe('getWeatherForecast - Latitude Thresholds & Boundaries', () => {
    
    it('returns snow and -5C for Northern high latitudes (lat > 40)', async () => {
      const result = await weatherService.getWeatherForecast(45.5, -73.5);
      expect(result.temperature_c).toBe(-5);
      expect(result.condition).toBe('snow');
      expect(result).toHaveProperty('forecast_time');
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('returns snow and -5C for Southern high latitudes (lat < -40)', async () => {
      const result = await weatherService.getWeatherForecast(-45.5, 151.2);
      expect(result.temperature_c).toBe(-5);
      expect(result.condition).toBe('snow');
    });

    it('returns clear and 15C for temperate/equatorial latitudes between -40 and 40', async () => {
      const result = await weatherService.getWeatherForecast(12.97, 77.59);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('returns warm default (clear, 15C) at exact boundary lat = 40 (not > 40)', async () => {
      const result = await weatherService.getWeatherForecast(40, 0);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('returns warm default (clear, 15C) at exact boundary lat = -40 (not < -40)', async () => {
      const result = await weatherService.getWeatherForecast(-40, 0);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('falls through to warm default when latitude is NaN', async () => {
      const result = await weatherService.getWeatherForecast(NaN, 50);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('falls through to warm default when longitude is NaN', async () => {
      const result = await weatherService.getWeatherForecast(50, NaN);
      expect(result.temperature_c).toBe(15);
      expect(result.condition).toBe('clear');
    });

    it('falls through to warm default for non-numeric or non-finite lat/lng inputs (Infinity, strings)', async () => {
      expect((await weatherService.getWeatherForecast(Infinity, 10)).temperature_c).toBe(15);
      expect((await weatherService.getWeatherForecast(20, -Infinity)).temperature_c).toBe(15);
      expect((await weatherService.getWeatherForecast('invalid', 'coords')).temperature_c).toBe(15);
      expect((await weatherService.getWeatherForecast(null, undefined)).temperature_c).toBe(15);
    });

  });

  describe('checkSevereWeatherAdvisory (Enterprise Extension)', () => {
    
    it('returns true for extreme polar or high-altitude regions (|lat| > 60)', async () => {
      expect(await checkSevereWeatherAdvisory(65.1, -150.2)).toBe(true);
      expect(await checkSevereWeatherAdvisory(-62.5, 45.0)).toBe(true);
    });

    it('returns false for moderate latitudes (|lat| <= 60)', async () => {
      expect(await checkSevereWeatherAdvisory(45.0, 10.0)).toBe(false);
      expect(await checkSevereWeatherAdvisory(12.0, 77.0)).toBe(false);
    });

    it('returns false for invalid or non-finite coordinate inputs', async () => {
      expect(await checkSevereWeatherAdvisory(NaN, 50)).toBe(false);
      expect(await checkSevereWeatherAdvisory(Infinity, 10)).toBe(false);
      expect(await checkSevereWeatherAdvisory('abc', 'xyz')).toBe(false);
    });

  });

  describe('batchGetWeatherForecasts (Prototype Extension)', () => {
    
    it('concurrently fetches forecasts for a valid list of coordinates', async () => {
      const coords = [
        { lat: 50, lng: 10 }, // snow (-5C)
        { lat: 10, lng: 20 }  // clear (15C)
      ];
      
      const forecasts = await weatherService.batchGetWeatherForecasts(coords);
      expect(forecasts).toHaveLength(2);
      expect(forecasts[0].temperature_c).toBe(-5);
      expect(forecasts[1].temperature_c).toBe(15);
    });

    it('handles empty arrays or invalid batch payloads gracefully', async () => {
      expect(await weatherService.batchGetWeatherForecasts([])).toEqual([]);
      expect(await weatherService.batchGetWeatherForecasts(null)).toEqual([]);
      
      const malformed = [{ lat: 10 }]; // missing lng
      const results = await weatherService.batchGetWeatherForecasts(malformed);
      expect(results[0]).toHaveProperty('error', 'Invalid coordinates provided');
    });

  });

  describe('calculateWeatherFuelPenalty (Fleet Efficiency Utilities)', () => {
    
    it('applies 15% penalty multiplier for snow or freezing temperatures', () => {
      expect(calculateWeatherFuelPenalty('snow', 2)).toBe(1.15);
      expect(calculateWeatherFuelPenalty('clear', -5)).toBe(1.15);
      expect(calculateWeatherFuelPenalty('snow', -10)).toBe(1.15);
    });

    it('applies 5% penalty multiplier for chilly weather (0C to 10C)', () => {
      expect(calculateWeatherFuelPenalty('clear', 5)).toBe(1.05);
      expect(calculateWeatherFuelPenalty('cloudy', 9.9)).toBe(1.05);
    });

    it('applies 8% penalty multiplier for extreme heat (>35C due to AC load)', () => {
      expect(calculateWeatherFuelPenalty('clear', 38)).toBe(1.08);
    });

    it('returns baseline 1.0 multiplier for normal comfortable weather', () => {
      expect(calculateWeatherFuelPenalty('clear', 22)).toBe(1.0);
      expect(calculateWeatherFuelPenalty('sunny', 25)).toBe(1.0);
    });

    it('returns baseline 1.0 for invalid or non-numeric temperature inputs', () => {
      expect(calculateWeatherFuelPenalty('snow', NaN)).toBe(1.0);
      expect(calculateWeatherFuelPenalty('clear', 'warm')).toBe(1.0);
      expect(calculateWeatherFuelPenalty('clear', null)).toBe(1.0);
    });

  });

  describe('getMeteorologicalRegion (Bounding Box Descriptor)', () => {
    
    it('classifies regions correctly based on latitude boundaries', () => {
      expect(getMeteorologicalRegion(50, 0)).toBe('NORTH_TEMPERATE_POLAR');
      expect(getMeteorologicalRegion(-50, 0)).toBe('SOUTH_TEMPERATE_POLAR');
      expect(getMeteorologicalRegion(5, 77)).toBe('EQUATORIAL_TROPICAL');
      expect(getMeteorologicalRegion(25, 80)).toBe('MID_LATITUDE_ZONE');
    });

    it('returns UNKNOWN_REGION for invalid or non-finite coordinates', () => {
      expect(getMeteorologicalRegion(NaN, 50)).toBe('UNKNOWN_REGION');
      expect(getMeteorologicalRegion(10, Infinity)).toBe('UNKNOWN_REGION');
      expect(getMeteorologicalRegion('lat', 'lng')).toBe('UNKNOWN_REGION');
    });

  });

  describe('WeatherAdvisorUtilities Unified Export Object', () => {
    
    it('exposes all utility functions correctly', () => {
      expect(typeof WeatherAdvisorUtilities.calculateWeatherFuelPenalty).toBe('function');
      expect(typeof WeatherAdvisorUtilities.getMeteorologicalRegion).toBe('function');
      expect(WeatherAdvisorUtilities.calculateWeatherFuelPenalty('snow', -2)).toBe(1.15);
      expect(WeatherAdvisorUtilities.getMeteorologicalRegion(0, 0)).toBe('EQUATORIAL_TROPICAL');
    });

  });



  describe('assessRouteWeatherRisk (Route Logistics Risk Assessment)', () => {
    
    it('returns SEVERE risk and delay multiplier when route passes through polar regions', async () => {
      const route = [
        { lat: 20, lng: 70 },
        { lat: 65, lng: -140 } // Severe polar region
      ];
      const assessment = await weatherService.assessRouteWeatherRisk(route);
      expect(assessment.riskLevel).toBe('SEVERE');
      expect(assessment.severeWaypointCount).toBe(1);
      expect(assessment.delayMultiplier).toBe(1.35);
    });

    it('returns LOW risk and baseline multiplier for clear tropical routes', async () => {
      const route = [
        { lat: 10, lng: 78 },
        { lat: 15, lng: 80 }
      ];
      const assessment = await weatherService.assessRouteWeatherRisk(route);
      expect(assessment.riskLevel).toBe('LOW');
      expect(assessment.delayMultiplier).toBe(1.0);
    });

    it('handles empty or malformed route inputs gracefully', async () => {
      expect(await weatherService.assessRouteWeatherRisk([])).toEqual({ riskLevel: 'LOW', severeWaypointCount: 0, delayMultiplier: 1.0 });
      expect(await weatherService.assessRouteWeatherRisk(null)).toEqual({ riskLevel: 'LOW', severeWaypointCount: 0, delayMultiplier: 1.0 });
    });

  });
});