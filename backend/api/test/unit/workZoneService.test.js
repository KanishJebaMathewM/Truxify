import { describe, it, expect, vi } from 'vitest';
import {
  predictWorkZoneDelays,
  generateBypassWaypoint,
} from '../../src/services/workZoneService.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('workZoneService', () => {
  describe('predictWorkZoneDelays', () => {
    it('returns hasSevereDelay false when no points are provided', async () => {
      const result = await predictWorkZoneDelays({}, {}, [], '2025-01-15', '08:00');
      expect(result.hasSevereDelay).toBe(false);
      expect(result.predictedDelayMins).toBe(0);
    });

    it('returns hasSevereDelay false when all points are filtered out', async () => {
      const result = await predictWorkZoneDelays(
        { lat: null, lng: null },
        { lat: undefined, lng: undefined },
        [],
        '2025-01-15',
        '08:00'
      );
      expect(result.hasSevereDelay).toBe(false);
    });

    it('returns a valid delay prediction when start/end points are provided', async () => {
      const result = await predictWorkZoneDelays(
        { lat: 12.97, lng: 77.59 },
        { lat: 28.63, lng: 77.22 },
        [],
        '2025-01-15',
        '09:00'
      );
      expect(result).toHaveProperty('hasSevereDelay');
      expect(result).toHaveProperty('predictedDelayMins');
      expect(typeof result.predictedDelayMins).toBe('number');
    });

    it('includes waypoints in delay calculation', async () => {
      const result = await predictWorkZoneDelays(
        { lat: 38.9, lng: -77.0 },
        { lat: 40.7, lng: -74.0 },
        [{ lat: 39.5, lng: -76.0 }],
        '2025-06-01',
        '10:00'
      );
      expect(typeof result.predictedDelayMins).toBe('number');
      if (result.hasSevereDelay) {
        expect(result.problematicPoint).not.toBeNull();
      }
    });

  });

  describe('generateBypassWaypoint', () => {
    it('returns null when congestedPoint is null', () => {
      expect(generateBypassWaypoint(null)).toBeNull();
    });

    it('returns null when lat is missing', () => {
      expect(generateBypassWaypoint({ lng: 77.22 })).toBeNull();
    });

    it('returns null when lng is missing', () => {
      expect(generateBypassWaypoint({ lat: 12.97 })).toBeNull();
    });

    it('returns a bypass waypoint with lat and lng when input is valid', () => {
      const result = generateBypassWaypoint({ lat: 12.97, lng: 77.22 });
      expect(result).toHaveProperty('lat');
      expect(result).toHaveProperty('lng');
      expect(result).toHaveProperty('address');
      expect(typeof result.lat).toBe('number');
      expect(typeof result.lng).toBe('number');
    });

    it('shifts coordinates to generate bypass route', () => {
      const original = { lat: 12.97, lng: 77.22 };
      const result = generateBypassWaypoint(original);
      expect(result.lat).toBeCloseTo(12.97 + 7 / 111, 5);
      expect(result.lng).toBeCloseTo(77.22 + 7 / 111, 5);
    });
  });
});
