import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeatherService } from '../../../src/services/weatherService.js';

// Mock the external HTTP client or API dependency used by WeatherService
const mockApiClient = {
  get: vi.fn(),
};

// Mock the cache client if cache is handled internally or injected
const mockCacheStore = {
  get: vi.fn(),
  set: vi.fn(),
};

describe('WeatherService', () => {
  let weatherService;

  beforeEach(() => {
    vi.clearAllMocks();
    weatherService = new WeatherService(mockApiClient, mockCacheStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Coordinate Validation', () => {
    it('should throw an error for out-of-bounds latitude or longitude', async () => {
      const invalidLat = 100.0; // Valid latitude is between -90 and 90
      const validLon = 78.0;

      await expect(weatherService.getWeather(invalidLat, validLon)).rejects.toThrow(
        /invalid coordinates/i
      );
      expect(mockApiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('Caching Behavior', () => {
    it('should return cached weather data if available and avoid API calls', async () => {
      const lat = 13.0827;
      const lon = 80.2707;
      const cachedData = { temp: 32, condition: 'Sunny' };

      mockCacheStore.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await weatherService.getWeather(lat, lon);

      expect(mockCacheStore.get).toHaveBeenCalled();
      expect(mockApiClient.get).not.toHaveBeenCalled();
      expect(result).toEqual(cachedData);
    });

    it('should fetch from API and cache the result on cache miss', async () => {
      const lat = 13.0827;
      const lon = 80.2707;
      const apiData = { temp: 30, condition: 'Cloudy' };

      mockCacheStore.get.mockResolvedValue(null);
      mockApiClient.get.mockResolvedValue({ data: apiData });

      const result = await weatherService.getWeather(lat, lon);

      expect(mockCacheStore.get).toHaveBeenCalled();
      expect(mockApiClient.get).toHaveBeenCalled();
      expect(mockCacheStore.set).toHaveBeenCalled();
      expect(result).toEqual(apiData);
    });
  });

  describe('API Unavailability & Failure Handling', () => {
    it('should handle external API failures gracefully', async () => {
      const lat = 13.0827;
      const lon = 80.2707;

      mockCacheStore.get.mockResolvedValue(null);
      mockApiClient.get.mockRejectedValue(new Error('API Service Unavailable'));

      await expect(weatherService.getWeather(lat, lon)).rejects.toThrow(
        /api service unavailable/i
      );
    });
  });
});
