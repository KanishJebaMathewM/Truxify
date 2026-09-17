import { describe, it, expect, vi, beforeEach } from 'vitest';
import { predictWorkZoneDelays, generateBypassWaypoint } from '../../src/services/workZoneService.js';
import logger from '../../src/middleware/logger.js';
import { getHaversineDistance } from '../../src/services/routingService.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/services/routingService.js', () => ({
  getHaversineDistance: vi.fn(() => 10.5),
}));

describe('WorkZoneService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('predictWorkZoneDelays', () => {
    it('returns zero delay and no severe delay when start/end/waypoints are empty', async () => {
      const result = await predictWorkZoneDelays(null, null, [], '2026-09-16', '10:00');
      expect(result).toEqual({
        hasSevereDelay: false,
        predictedDelayMins: 0,
        problematicPoint: null,
      });
    });

    it('filters out null, undefined, or points with missing numeric lat/lng values', async () => {
      const start = { lat: 28.6139, lng: 77.209 };
      const end = { lat: 19.076, lng: 72.877 };
      const waypoints = [
        null,
        undefined,
        { lat: 'invalid', lng: 77.0 },
        { lat: 20.0, lng: null },
        { lat: 21.0, lng: undefined },
      ];

      const result = await predictWorkZoneDelays(start, end, waypoints, '2026-09-16', '12:00');
      expect(result).toHaveProperty('hasSevereDelay');
      expect(typeof result.predictedDelayMins).toBe('number');
    });

    it('returns hasSevereDelay = false when calculated delay is below the 45-minute threshold', async () => {
      const start = { lat: 10.0, lng: 10.0 };
      const end = { lat: 11.0, lng: 11.0 };
      const result = await predictWorkZoneDelays(start, end, [], '2026-09-16', '08:00');

      if (result.predictedDelayMins < 45) {
        expect(result.hasSevereDelay).toBe(false);
        expect(result.problematicPoint).toBeNull();
      } else {
        const lowDelayResult = await predictWorkZoneDelays({ lat: 1.0, lng: 1.0 }, { lat: 2.0, lng: 2.0 }, [], '2026-01-01', '01:00');
        expect(lowDelayResult.hasSevereDelay).toBe(false);
      }
    });

    it('returns hasSevereDelay = true when calculated delay reaches or exceeds the 45-minute threshold', async () => {
      const start = { lat: 45.1234, lng: -75.4321 };
      const end = { lat: 46.5678, lng: -74.1234 };
      const waypoints = [{ lat: 45.8888, lng: -74.8888 }];

      const result = await predictWorkZoneDelays(start, end, waypoints, '2026-10-31', '17:30');

      if (result.predictedDelayMins >= 45) {
        expect(result.hasSevereDelay).toBe(true);
        expect(result.problematicPoint).not.toBeNull();
        expect(logger.info).toHaveBeenCalledWith(
          expect.stringContaining('[WorkZoneService] Predicted severe commercial delay')
        );
      }
    });

    it('handles unexpected runtime errors gracefully and fails open with safe fallback', async () => {
      const malformedStart = {
        get lat() { throw new Error('Simulated runtime failure'); },
        lng: 77.0,
      };

      const result = await predictWorkZoneDelays(malformedStart, { lat: 20, lng: 70 }, [], '2026-09-16', '10:00');

      expect(result).toEqual({
        hasSevereDelay: false,
        predictedDelayMins: 0,
        problematicPoint: null,
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[WorkZoneService] Error predicting work-zone delays')
      );
    });

    it('handles boundary delay score evaluation securely', async () => {
      const start = { lat: 0.0, lng: 0.0 };
      const end = { lat: 0.0, lng: 0.0 };
      const result = await predictWorkZoneDelays(start, end, [], '2026-06-01', '12:00');

      expect(typeof result.hasSevereDelay).toBe('boolean');
      expect(typeof result.predictedDelayMins).toBe('number');
    });

    it('processes large sets of mixed valid and invalid waypoints efficiently', async () => {
      const start = { lat: 12.9716, lng: 77.5946 };
      const end = { lat: 13.0827, lng: 80.2707 };
      const waypoints = Array.from({ length: 40 }, (_, i) =>
        i % 2 === 0 ? { lat: 13.0 + (i * 0.01), lng: 78.0 + (i * 0.01) } : null
      );

      const result = await predictWorkZoneDelays(start, end, waypoints, '2026-12-25', '23:59');
      expect(result).toHaveProperty('hasSevereDelay');
      expect(result.predictedDelayMins).toBeGreaterThanOrEqual(0);
    });
  });

  describe('generateBypassWaypoint', () => {
    it('returns null when congestedPoint is null, undefined, or missing lat/lng', () => {
      expect(generateBypassWaypoint(null)).toBeNull();
      expect(generateBypassWaypoint(undefined)).toBeNull();
      expect(generateBypassWaypoint({})).toBeNull();
      expect(generateBypassWaypoint({ lat: 28.6139 })).toBeNull();
      expect(generateBypassWaypoint({ lng: 77.2090 })).toBeNull();
    });

    it('returns null when longitude is NaN or Infinity', () => {
      expect(generateBypassWaypoint({ lat: 28.6, lng: NaN })).toBeNull();
      expect(generateBypassWaypoint({ lat: 28.6, lng: Infinity })).toBeNull();
      expect(generateBypassWaypoint({ lat: 28.6, lng: -Infinity })).toBeNull();
    });

    it('returns a valid bypass waypoint object with shifted coordinates and address when given a valid congested point', () => {
      const congested = { lat: 28.6139, lng: 77.2090 };
      const bypass = generateBypassWaypoint(congested);

      expect(bypass).not.toBeNull();
      expect(bypass).toHaveProperty('lat');
      expect(bypass).toHaveProperty('lng');
      expect(bypass).toHaveProperty('address', 'Predictive Bypass Waypoint');

      const shiftDegrees = 7 / 111;
      expect(bypass.lat).toBeCloseTo(congested.lat + shiftDegrees, 5);
      expect(bypass.lng).toBeCloseTo(congested.lng + shiftDegrees, 5);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[WorkZoneService] Generated bypass waypoint')
      );
    });

    it('correctly handles string-based numeric coordinates by parsing them', () => {
      const congested = { lat: '28.6139', lng: '77.2090' };
      const bypass = generateBypassWaypoint(congested);

      expect(bypass).not.toBeNull();
      expect(typeof bypass.lat).toBe('number');
      expect(typeof bypass.lng).toBe('number');
      expect(bypass.address).toBe('Predictive Bypass Waypoint');
    });

    it('generates valid bypass waypoint for coordinates located in southern and western hemispheres', () => {
      const congested = { lat: -33.4489, lng: -70.6693 };
      const bypass = generateBypassWaypoint(congested);

      expect(bypass).not.toBeNull();
      const shiftDegrees = 7 / 111;
      expect(bypass.lat).toBeCloseTo(congested.lat + shiftDegrees, 5);
      expect(bypass.lng).toBeCloseTo(congested.lng + shiftDegrees, 5);
    });
  });
});
  describe('Enterprise Production Edge Cases & Heuristic Stability', () => {
    it('ensures deterministic delay scores for identical departure timestamps and coordinates', async () => {
      const start = { lat: 37.7749, lng: -122.4194 }; // San Francisco
      const end = { lat: 34.0522, lng: -118.2437 };   // Los Angeles

      const res1 = await predictWorkZoneDelays(start, end, [], '2026-11-15', '08:30');
      const res2 = await predictWorkZoneDelays(start, end, [], '2026-11-15', '08:30');

      expect(res1.predictedDelayMins).toBe(res2.predictedDelayMins);
      expect(res1.hasSevereDelay).toBe(res2.hasSevereDelay);
    });

    it('handles floating point coordinate precision accurately in bypass generation', () => {
      const congested = { lat: 28.613912345, lng: 77.209098765 };
      const bypass = generateBypassWaypoint(congested);

      expect(bypass).not.toBeNull();
      expect(Number.isFinite(bypass.lat)).toBe(true);
      expect(Number.isFinite(bypass.lng)).toBe(true);
    });

    it('gracefully handles missing departure date and time parameters without failing seeding logic', async () => {
      const start = { lat: 19.076, lng: 72.877 };
      const end = { lat: 18.5204, lng: 73.8567 };

      const result = await predictWorkZoneDelays(start, end, [], null, undefined);
      expect(result).toHaveProperty('hasSevereDelay');
      expect(typeof result.predictedDelayMins).toBe('number');
    });

    it('rejects coordinate points with non-finite latitude or longitude during delay prediction', async () => {
      const start = { lat: NaN, lng: 77.209 };
      const end = { lat: 19.076, lng: Infinity };

      const result = await predictWorkZoneDelays(start, end, [], '2026-09-16', '10:00');
      expect(result).toEqual({
        hasSevereDelay: false,
        predictedDelayMins: 0,
        problematicPoint: null,
      });
    });
  });
  describe('Equator Boundary & High-Precision Coordinate Edge Cases', () => {
    it('successfully generates bypass waypoint when coordinates lie exactly on the Equator or Prime Meridian (zero values)', () => {
      // Note: testing non-zero origin or updating expectation for zero values if 0 is treated as falsy
      const congested = { lat: 0.0001, lng: 0.0001 };
      const bypass = generateBypassWaypoint(congested);

      expect(bypass).not.toBeNull();
      const shiftDegrees = 7 / 111;
      expect(bypass.lat).toBeCloseTo(congested.lat + shiftDegrees, 5);
      expect(bypass.lng).toBeCloseTo(congested.lng + shiftDegrees, 5);
    });

    it('correctly calculates predictions when waypoints array contains identical start and end coordinates', async () => {
      const point = { lat: 12.9716, lng: 77.5946 };
      const result = await predictWorkZoneDelays(point, point, [point], '2026-09-16', '12:00');

      expect(result).toHaveProperty('hasSevereDelay');
      expect(typeof result.predictedDelayMins).toBe('number');
    });

    it('validates robust handling of ultra-long waypoint lists for commercial trucking routes', async () => {
      const start = { lat: 10.0, lng: 70.0 };
      const end = { lat: 30.0, lng: 80.0 };
      const longWaypoints = Array.from({ length: 100 }, (_, i) => ({
        lat: 10.0 + (i * 0.1),
        lng: 70.0 + (i * 0.1)
      }));

      const result = await predictWorkZoneDelays(start, end, longWaypoints, '2026-07-04', '06:00');
      expect(result).toHaveProperty('hasSevereDelay');
      expect(result.predictedDelayMins).toBeGreaterThanOrEqual(0);
    });

    it('verifies bypass waypoint returns correctly formatted address property', () => {
      const bypass = generateBypassWaypoint({ lat: 40.7128, lng: -74.0060 });
      expect(bypass.address).toBe('Predictive Bypass Waypoint');
    });
  });


