import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/config/db.js', () => ({ redisClient: null }));

import { getLiveTrafficMultiplier, getTrafficForRoute } from '../../src/services/trafficService.js';

describe('Google traffic departure-time contract', () => {
  beforeEach(() => {
    vi.stubEnv('TOMTOM_API_KEY', '');
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-only-google-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function installGoogleReply({ trafficAvailable = true, ok = true } = {}) {
    const requests = [];
    vi.stubGlobal('fetch', vi.fn(async address => {
      const url = new URL(address);
      requests.push(url);
      // Google's documented response only includes traffic duration when
      // a driving departure time was supplied and traffic is available.
      const hasTraffic = trafficAvailable && url.searchParams.get('departure_time') === 'now';
      return {
        ok, status: ok ? 200 : 503,
        json: async () => ({ rows: [{ elements: [{
          status: 'OK', duration: { value: 120 },
          ...(hasTraffic ? { duration_in_traffic: { value: 240 } } : {}),
        }] }] }),
      };
    }));
    return requests;
  }

  it('requests current driving traffic for the live pricing/ETA multiplier', async () => {
    const requests = installGoogleReply();
    expect(await getLiveTrafficMultiplier(28.61, 77.23)).toBe(2);
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('departure_time')).toBe('now');
    expect(requests[0].searchParams.get('mode')).toBe('driving');
    expect(requests[0].searchParams.get('origins')).toBe('28.61,77.23');
    expect(requests[0].searchParams.get('key')).toBe('test-only-google-key');
  });

  it('uses the same request contract for route congestion and delay', async () => {
    const requests = installGoogleReply();
    const result = await getTrafficForRoute({ origin: [28.61, 77.23], destination: [28.62, 77.24] });
    expect(result.multiplier).toBe(2);
    expect(result.delayMinutes).toBe(2);
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('departure_time')).toBe('now');
    expect(requests[0].searchParams.get('mode')).toBe('driving');
    expect(requests[0].searchParams.get('destinations')).toBe('28.62,77.24');
  });

  it('keeps baseline fallback when the provider has no traffic duration', async () => {
    installGoogleReply({ trafficAvailable: false });
    expect(await getLiveTrafficMultiplier(28.61, 77.23)).toBe(1);
  });

  it('keeps baseline fallback when the Google request fails', async () => {
    installGoogleReply({ ok: false });
    expect(await getLiveTrafficMultiplier(28.61, 77.23)).toBe(1);
  });

  it('makes no provider request when no key is configured', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    const requests = installGoogleReply();
    expect(await getLiveTrafficMultiplier(28.61, 77.23)).toBe(1);
    expect(requests).toHaveLength(0);
  });
});
