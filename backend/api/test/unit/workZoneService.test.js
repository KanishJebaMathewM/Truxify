import { describe, it, expect, vi, beforeEach } from 'vitest';
import workZoneService, {
  WorkZoneService,
  predictWorkZoneDelays,
  generateBypassWaypoint,
  queryWorkZones,
  getWorkZonesInBounds,
  filterWorkZones,
  filterWorkZonesByType,
  generateWorkZoneAlert,
  generateWorkZoneAlerts,
  getActiveWorkZoneAlerts,
  registerWorkZone,
  unregisterWorkZone,
  resetWorkZones,
  clearWorkZoneCache,
  normalizeBounds,
  WORK_ZONE_TYPES,
  WORK_ZONE_SEVERITY,
  WORK_ZONE_STATUS,
} from '../../src/services/workZoneService.js';
import logger from '../../src/middleware/logger.js';
import { redisClient } from '../../src/config/db.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(1),
  },
}));

describe('WorkZoneService Unit Tests', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    workZoneService.resetWorkZones();
    await workZoneService.clearWorkZoneCache();
  });

  describe('normalizeBounds', () => {
    it('normalizes object bounds with minLat/maxLat/minLng/maxLng', () => {
      const bounds = { minLat: 10, maxLat: 20, minLng: 70, maxLng: 80 };
      const normalized = normalizeBounds(bounds);
      expect(normalized).toEqual({ minLat: 10, maxLat: 20, minLng: 70, maxLng: 80 });
    });

    it('normalizes directional property names (south, north, west, east)', () => {
      const bounds = { south: 12.5, north: 19.8, west: 72.0, east: 79.5 };
      const normalized = normalizeBounds(bounds);
      expect(normalized).toEqual({ minLat: 12.5, maxLat: 19.8, minLng: 72.0, maxLng: 79.5 });
    });

    it('normalizes 4-element coordinate arrays [minLng, minLat, maxLng, maxLat]', () => {
      const bounds = [72.8, 18.9, 78.5, 28.6];
      const normalized = normalizeBounds(bounds);
      expect(normalized).toEqual({ minLat: 18.9, maxLat: 28.6, minLng: 72.8, maxLng: 78.5 });
    });

    it('auto-corrects inverted bounds where min > max', () => {
      const bounds = { minLat: 25.0, maxLat: 15.0, minLng: 80.0, maxLng: 70.0 };
      const normalized = normalizeBounds(bounds);
      expect(normalized).toEqual({ minLat: 15.0, maxLat: 25.0, minLng: 70.0, maxLng: 80.0 });
    });

    it('returns null for null, undefined, or malformed bounds', () => {
      expect(normalizeBounds(null)).toBeNull();
      expect(normalizeBounds(undefined)).toBeNull();
      expect(normalizeBounds({})).toBeNull();
      expect(normalizeBounds('invalid')).toBeNull();
      expect(normalizeBounds([10, 20])).toBeNull();
      expect(normalizeBounds({ minLat: 'abc', maxLat: 20, minLng: 70, maxLng: 80 })).toBeNull();
    });

    it('returns null for out-of-range coordinates', () => {
      expect(normalizeBounds({ minLat: -100, maxLat: 20, minLng: 70, maxLng: 80 })).toBeNull();
      expect(normalizeBounds({ minLat: 10, maxLat: 95, minLng: 70, maxLng: 80 })).toBeNull();
      expect(normalizeBounds({ minLat: 10, maxLat: 20, minLng: -200, maxLng: 80 })).toBeNull();
      expect(normalizeBounds({ minLat: 10, maxLat: 20, minLng: 70, maxLng: 200 })).toBeNull();
    });
  });

  describe('Geographic Bounds Querying (queryWorkZones & getWorkZonesInBounds)', () => {
    it('queries work zones falling within the given geographic bounding box', async () => {
      // Surat (21.1702, 72.8311) is in Western India bounding box
      const bounds = { minLat: 20.0, maxLat: 23.0, minLng: 71.0, maxLng: 74.0 };
      const results = await queryWorkZones(bounds);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(1);
      const suratWz = results.find(wz => wz.id === 'WZ-MUM-DEL-01');
      expect(suratWz).toBeDefined();
      expect(suratWz.type).toBe(WORK_ZONE_TYPES.CONSTRUCTION);
    });

    it('returns empty array when no work zones exist within bounding box', async () => {
      // Atlantic Ocean bounds
      const bounds = { minLat: 0.0, maxLat: 5.0, minLng: -30.0, maxLng: -25.0 };
      const results = await getWorkZonesInBounds(bounds);
      expect(results).toEqual([]);
    });

    it('handles query with array-based bounding box', async () => {
      // Delhi/Agra region [minLng, minLat, maxLng, maxLat]
      const bounds = [76.0, 26.0, 79.0, 29.0];
      const results = await queryWorkZones(bounds);
      const agraWz = results.find(wz => wz.id === 'WZ-DEL-AGR-02');
      expect(agraWz).toBeDefined();
      expect(agraWz.type).toBe(WORK_ZONE_TYPES.ACCIDENT);
    });

    it('returns empty array and logs warning on invalid bounds', async () => {
      const results = await queryWorkZones({ minLat: 'bad' });
      expect(results).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WorkZoneService] Invalid geographic bounds')
      );
    });
  });

  describe('Work Zone Filtering by Type (construction, accident, closure, maintenance)', () => {
    it('filters work zones by single type (construction)', () => {
      const sample = [
        { id: '1', type: 'construction', status: 'active' },
        { id: '2', type: 'accident', status: 'active' },
        { id: '3', type: 'closure', status: 'active' },
      ];

      const filtered = filterWorkZonesByType(sample, WORK_ZONE_TYPES.CONSTRUCTION);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('1');
    });

    it('filters work zones by accident type', () => {
      const sample = [
        { id: '1', type: 'construction' },
        { id: '2', type: 'accident' },
        { id: '3', type: 'closure' },
      ];

      const filtered = filterWorkZonesByType(sample, 'accident');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('2');
    });

    it('filters work zones by closure type', () => {
      const sample = [
        { id: '1', type: 'construction' },
        { id: '2', type: 'accident' },
        { id: '3', type: 'closure' },
      ];

      const filtered = filterWorkZonesByType(sample, WORK_ZONE_TYPES.CLOSURE);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('3');
    });

    it('filters by multiple types simultaneously using array', () => {
      const sample = [
        { id: '1', type: 'construction' },
        { id: '2', type: 'accident' },
        { id: '3', type: 'closure' },
        { id: '4', type: 'maintenance' },
      ];

      const filtered = filterWorkZones(sample, { types: ['construction', 'closure'] });
      expect(filtered).toHaveLength(2);
      expect(filtered.map(w => w.id)).toEqual(['1', '3']);
    });

    it('filters case-insensitively', () => {
      const sample = [
        { id: '1', type: 'CONSTRUCTION' },
        { id: '2', type: 'Accident' },
        { id: '3', type: 'CLOSURE' },
      ];

      const filtered = filterWorkZonesByType(sample, 'construction');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('1');
    });

    it('filters by status and severity in addition to type', () => {
      const sample = [
        { id: '1', type: 'construction', status: 'active', severity: 'high', estimatedDelayMins: 40 },
        { id: '2', type: 'construction', status: 'scheduled', severity: 'medium', estimatedDelayMins: 20 },
        { id: '3', type: 'accident', status: 'active', severity: 'critical', estimatedDelayMins: 60 },
      ];

      const activeConstruction = filterWorkZones(sample, {
        type: 'construction',
        status: 'active',
        severity: 'high',
      });
      expect(activeConstruction).toHaveLength(1);
      expect(activeConstruction[0].id).toBe('1');
    });

    it('filters by minimum delay minutes', () => {
      const sample = [
        { id: '1', estimatedDelayMins: 10 },
        { id: '2', estimatedDelayMins: 30 },
        { id: '3', estimatedDelayMins: 50 },
      ];

      const highDelays = filterWorkZones(sample, { minDelayMinutes: 30 });
      expect(highDelays).toHaveLength(2);
      expect(highDelays.map(w => w.id)).toEqual(['2', '3']);
    });

    it('returns empty array when passed non-array inputs', () => {
      expect(filterWorkZones(null)).toEqual([]);
      expect(filterWorkZones(undefined)).toEqual([]);
    });
  });

  describe('Alert Generation for Active Work Zones', () => {
    it('generates a structured real-time alert payload from a work zone record', () => {
      const workZone = {
        id: 'WZ-TEST-01',
        type: WORK_ZONE_TYPES.CONSTRUCTION,
        severity: WORK_ZONE_SEVERITY.HIGH,
        status: WORK_ZONE_STATUS.ACTIVE,
        title: 'Bridge Expansion Project',
        description: 'Single lane operation in effect.',
        lat: 19.0760,
        lng: 72.8777,
        estimatedDelayMins: 50,
      };

      const alert = generateWorkZoneAlert(workZone);
      expect(alert).not.toBeNull();
      expect(alert.alertId).toBe('WZ-ALERT-WZ-TEST-01');
      expect(alert.workZoneId).toBe('WZ-TEST-01');
      expect(alert.type).toBe('construction');
      expect(alert.severity).toBe('high');
      expect(alert.active).toBe(true);
      expect(alert.hasSevereDelay).toBe(true);
      expect(alert.delayMinutes).toBe(50);
      expect(alert.location).toEqual({
        lat: 19.0760,
        lng: 72.8777,
        address: 'Bridge Expansion Project',
      });
      expect(alert.suggestedBypass).not.toBeNull();
      expect(alert.suggestedBypass.lat).toBeCloseTo(19.0760 + 7 / 111, 4);
    });

    it('omits suggested bypass when estimated delay is under 15 minutes', () => {
      const workZone = {
        id: 'WZ-MINOR-01',
        type: WORK_ZONE_TYPES.MAINTENANCE,
        status: WORK_ZONE_STATUS.ACTIVE,
        lat: 12.0,
        lng: 77.0,
        estimatedDelayMins: 10,
      };

      const alert = generateWorkZoneAlert(workZone);
      expect(alert.suggestedBypass).toBeNull();
      expect(alert.hasSevereDelay).toBe(false);
    });

    it('returns null when invalid work zone is passed to generateWorkZoneAlert', () => {
      expect(generateWorkZoneAlert(null)).toBeNull();
      expect(generateWorkZoneAlert(undefined)).toBeNull();
    });

    it('generates multiple alerts and filters for active work zones by default', () => {
      const workZones = [
        { id: 'WZ-1', status: WORK_ZONE_STATUS.ACTIVE, type: 'construction' },
        { id: 'WZ-2', status: WORK_ZONE_STATUS.SCHEDULED, type: 'closure' },
        { id: 'WZ-3', status: WORK_ZONE_STATUS.ACTIVE, type: 'accident' },
      ];

      const alerts = generateWorkZoneAlerts(workZones);
      expect(alerts).toHaveLength(2);
      expect(alerts.map(a => a.workZoneId)).toEqual(['WZ-1', 'WZ-3']);
    });

    it('generates alerts including inactive work zones when activeOnly is false', () => {
      const workZones = [
        { id: 'WZ-1', status: WORK_ZONE_STATUS.ACTIVE },
        { id: 'WZ-2', status: WORK_ZONE_STATUS.SCHEDULED },
      ];

      const alerts = generateWorkZoneAlerts(workZones, { activeOnly: false });
      expect(alerts).toHaveLength(2);
    });

    it('filters generated alerts by minimum severity', () => {
      const workZones = [
        { id: 'WZ-1', status: 'active', severity: 'low' },
        { id: 'WZ-2', status: 'active', severity: 'medium' },
        { id: 'WZ-3', status: 'active', severity: 'high' },
        { id: 'WZ-4', status: 'active', severity: 'critical' },
      ];

      const highAlerts = generateWorkZoneAlerts(workZones, { minSeverity: 'high' });
      expect(highAlerts).toHaveLength(2);
      expect(highAlerts.map(a => a.workZoneId)).toEqual(['WZ-3', 'WZ-4']);
    });

    it('getActiveWorkZoneAlerts combines geographic query and alert generation', async () => {
      // Whole India bounds
      const bounds = { minLat: 8.0, maxLat: 35.0, minLng: 68.0, maxLng: 90.0 };
      const alerts = await getActiveWorkZoneAlerts(bounds);

      expect(Array.isArray(alerts)).toBe(true);
      expect(alerts.length).toBeGreaterThan(0);
      for (const alert of alerts) {
        expect(alert.active).toBe(true);
        expect(alert).toHaveProperty('alertId');
        expect(alert).toHaveProperty('type');
      }
    });
  });

  describe('Caching Behavior (Memory & Redis)', () => {
    it('caches query results in-memory and increments cache hits on subsequent queries', async () => {
      const bounds = { minLat: 10.0, maxLat: 25.0, minLng: 70.0, maxLng: 80.0 };

      const statsBefore = workZoneService.getCacheStats();
      const firstQuery = await queryWorkZones(bounds);
      const statsAfterFirst = workZoneService.getCacheStats();
      expect(statsAfterFirst.misses).toBe(statsBefore.misses + 1);

      const secondQuery = await queryWorkZones(bounds);
      const statsAfterSecond = workZoneService.getCacheStats();
      expect(statsAfterSecond.hits).toBe(statsAfterFirst.hits + 1);
      expect(secondQuery).toEqual(firstQuery);
    });

    it('bypasses cache when bypassCache option is set to true', async () => {
      const bounds = { minLat: 10.0, maxLat: 25.0, minLng: 70.0, maxLng: 80.0 };

      await queryWorkZones(bounds);
      const hitsBefore = workZoneService.getCacheStats().hits;

      await queryWorkZones(bounds, { bypassCache: true });
      const hitsAfter = workZoneService.getCacheStats().hits;
      expect(hitsAfter).toBe(hitsBefore);
    });

    it('clears in-memory and Redis cache when clearWorkZoneCache is called', async () => {
      const bounds = { minLat: 10.0, maxLat: 25.0, minLng: 70.0, maxLng: 80.0 };
      await queryWorkZones(bounds);
      expect(workZoneService.getCacheStats().memoryEntries).toBeGreaterThan(0);

      await clearWorkZoneCache();
      expect(workZoneService.getCacheStats().memoryEntries).toBe(0);
    });

    it('reads from Redis cache when key exists in Redis but not in local memory', async () => {
      const bounds = { minLat: 15.0, maxLat: 16.0, minLng: 77.0, maxLng: 79.0 };
      const cachedData = [{ id: 'REDIS-WZ-01', lat: 15.5, lng: 78.0, type: 'closure' }];

      vi.mocked(redisClient.get).mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await queryWorkZones(bounds);
      expect(result).toEqual(cachedData);
      expect(redisClient.get).toHaveBeenCalledWith(expect.stringContaining('workzone:'));
    });

    it('generates distinct cache keys for different filters on the same bounds', async () => {
      const bounds = { minLat: 10.0, maxLat: 25.0, minLng: 70.0, maxLng: 80.0 };

      await queryWorkZones(bounds, { type: 'construction' });
      await queryWorkZones(bounds, { type: 'accident' });

      expect(workZoneService.getCacheStats().memoryEntries).toBe(2);
    });
  });

  describe('Work Zone Registration and Management', () => {
    it('allows dynamic registration and querying of new work zones', async () => {
      const newZone = {
        id: 'WZ-CUSTOM-99',
        type: WORK_ZONE_TYPES.HAZARD,
        lat: 13.0827,
        lng: 80.2707,
        severity: WORK_ZONE_SEVERITY.HIGH,
        title: 'Chennai Port Heavy Waterlogging',
        estimatedDelayMins: 35,
      };

      const registered = registerWorkZone(newZone);
      expect(registered.id).toBe('WZ-CUSTOM-99');

      const results = await queryWorkZones({
        minLat: 13.0,
        maxLat: 13.5,
        minLng: 80.0,
        maxLng: 80.5,
      });

      const found = results.find(w => w.id === 'WZ-CUSTOM-99');
      expect(found).toBeDefined();
      expect(found.type).toBe('hazard');
    });

    it('rejects registration with invalid coordinates', () => {
      expect(() => registerWorkZone(null)).toThrow('Work zone data is required');
      expect(() => registerWorkZone({ lat: 'bad', lng: 77 })).toThrow('Valid lat and lng');
      expect(() => registerWorkZone({ lat: 120, lng: 77 })).toThrow('Coordinates out of range');
    });

    it('unregisters work zone by ID and invalidates cache', async () => {
      const bounds = { minLat: 20.0, maxLat: 23.0, minLng: 71.0, maxLng: 74.0 };
      await queryWorkZones(bounds);

      const deleted = unregisterWorkZone('WZ-MUM-DEL-01');
      expect(deleted).toBe(true);

      const results = await queryWorkZones(bounds);
      expect(results.find(w => w.id === 'WZ-MUM-DEL-01')).toBeUndefined();
    });
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

    it('returns a valid bypass waypoint object with shifted coordinates and address', () => {
      const congested = { lat: 28.6139, lng: 77.2090 };
      const bypass = generateBypassWaypoint(congested);

      expect(bypass).not.toBeNull();
      expect(bypass).toHaveProperty('lat');
      expect(bypass).toHaveProperty('lng');
      expect(bypass).toHaveProperty('address', 'Predictive Bypass Waypoint');

      const shiftDegrees = 7 / 111;
      expect(bypass.lat).toBeCloseTo(congested.lat + shiftDegrees, 5);
      expect(bypass.lng).toBeCloseTo(congested.lng + shiftDegrees, 5);
    });
  });

  describe('WorkZoneService Class Instance Instantiation', () => {
    it('supports standalone instance instantiation with independent caches', async () => {
      const standalone = new WorkZoneService();
      expect(standalone.workZones.size).toBeGreaterThan(0);
      const results = await standalone.queryWorkZones({ minLat: 10, maxLat: 30, minLng: 70, maxLng: 85 });
      expect(results.length).toBeGreaterThan(0);
    });
  });
});



