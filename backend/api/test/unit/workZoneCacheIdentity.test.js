import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkZoneService } from '../../src/services/workZoneService.js';
import { redisClient } from '../../src/config/db.js';

vi.mock('../../src/config/db.js', () => ({
  redisClient: { get: vi.fn(), set: vi.fn() },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const bounds = { minLat: 10, maxLat: 11, minLng: 20, maxLng: 21 };
let service;
beforeEach(() => {
  vi.resetAllMocks();
  service = new WorkZoneService();
  service.workZones.clear();
  service.registerWorkZone({ id: 'short', lat: 10.5, lng: 20.5, estimatedDelayMins: 10 });
  service.registerWorkZone({ id: 'long', lat: 10.5, lng: 20.5, estimatedDelayMins: 60 });
});

describe('work-zone query cache identity', () => {
  it.each([false, true])('keeps delay-filter results independent (strict first: %s)', async strictFirst => {
    const options = strictFirst ? [{ minDelayMinutes: 45 }, {}] : [{}, { minDelayMinutes: 45 }];
    for (const option of options) {
      const result = await service.queryWorkZones(bounds, option);
      expect(result.map(zone => zone.id)).toEqual(option.minDelayMinutes ? ['long'] : ['short', 'long']);
    }
  });

  it('does not alias distinct bounds rounded to the same thousandth', async () => {
    const narrow = { ...bounds, maxLat: 10.5001 };
    const wide = { ...bounds, maxLat: 10.5004 };
    service.registerWorkZone({ id: 'edge', lat: 10.5003, lng: 20.5 });
    expect((await service.queryWorkZones(narrow)).map(zone => zone.id)).not.toContain('edge');
    expect((await service.queryWorkZones(wide)).map(zone => zone.id)).toContain('edge');
  });

  it('uses independent Redis keys after clearing the local cache', async () => {
    const remote = new Map();
    redisClient.get.mockImplementation(key => remote.get(key));
    redisClient.set.mockImplementation((key, value) => remote.set(key, value));
    await service.queryWorkZones(bounds);
    service.clearMemoryCache();
    expect((await service.queryWorkZones(bounds, { minDelayMinutes: 45 })).map(zone => zone.id)).toEqual(['long']);
    expect(remote.size).toBe(2);
  });

  it('keeps case-equivalent filter queries in one cache entry', async () => {
    await service.queryWorkZones(bounds, { status: 'ACTIVE', minDelayMinutes: '45' });
    await service.queryWorkZones(bounds, { status: 'active', minDelayMinutes: 45 });
    expect(service.getCacheStats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('does not mutate caller-owned status or severity arrays', async () => {
    const status = Object.freeze(['scheduled', 'active']);
    const severity = Object.freeze(['medium', 'low']);
    await expect(service.queryWorkZones(bounds, { status, severity })).resolves.toHaveLength(2);
  });
});
