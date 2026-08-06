import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.ML_API_KEY = 'test-ml-key';
process.env.ML_ENGINE_URL = 'http://ml.test:8001';

vi.mock('../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { recommendLoads, recommendTrucks } = await import('../src/services/ml.js');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe('ml.recommendLoads (issue #4512)', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ recommendations: [] }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('actually performs the HTTP POST (regression: previously returned before fetch)', async () => {
    await recommendLoads({ userId: 'u-1', topN: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('posts to /recommend/loads with the correct headers and payload', async () => {
    await recommendLoads({
      userId: 'u-1',
      bookingHistory: ['b-1'],
      ratedDrivers: ['d-9'],
      topN: 3,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ml.test:8001/recommend/loads');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['X-API-Key']).toBe('test-ml-key');
    expect(JSON.parse(init.body)).toEqual({
      user_id: 'u-1',
      booking_history: ['b-1'],
      rated_drivers: ['d-9'],
      top_n: 3,
    });
    expect(init.signal).toBeDefined();
  });

  it('parses the engine response through handleResponse', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ recommendations: [{ load_id: 'l-1' }] }),
    );

    const result = await recommendLoads({ userId: 'u-1' });

    expect(result).toEqual({ recommendations: [{ load_id: 'l-1' }] });
  });

  it('propagates non-OK responses as errors instead of returning undefined', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'boom' }, 500));

    await expect(recommendLoads({ userId: 'u-1' })).rejects.toThrow(
      /Request failed \(500\)/,
    );
  });

  it('sends a different payload shape than recommendTrucks', async () => {
    await recommendLoads({ userId: 'u-1', ratedDrivers: ['d-9'] });
    await recommendTrucks({ userId: 'u-1', ratedLoads: ['l-9'] });

    const loadsBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const trucksBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(loadsBody).toHaveProperty('rated_drivers');
    expect(loadsBody).not.toHaveProperty('rated_loads');
    expect(trucksBody).toHaveProperty('rated_loads');
    expect(trucksBody).not.toHaveProperty('rated_drivers');
  });
});
