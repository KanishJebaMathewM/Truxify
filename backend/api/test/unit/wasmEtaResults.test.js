import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ calculateETA: vi.fn() }));
vi.mock('../../../../wasm/edge-runtime.js', () => ({ default: { calculateETA: mocks.calculateETA } }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: vi.fn() }));
vi.mock('../../src/middleware/requirePolicy.js', () => ({ requirePolicy: () => vi.fn() }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import router from '../../../../wasm/routes.js';
const handler = router.stack.find((layer) => layer.route?.path === '/wasm/eta').route.stack[0].handle;
function response() {
  const res = { statusCode: 200, json: vi.fn() };
  res.status = vi.fn((status) => { res.statusCode = status; return res; });
  return res;
}
beforeEach(() => mocks.calculateETA.mockReset().mockResolvedValue(0.2));
afterEach(() => vi.unstubAllEnvs());

describe('WASM ETA response contract', () => {
  it.each([null, undefined])('returns unavailable for runtime sentinel %s', async (result) => {
    mocks.calculateETA.mockResolvedValueOnce(result);
    const res = response();
    await handler({ body: { distance: 10, speed: 50 } }, res);
    expect(res.statusCode).toBe(503);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'ETA calculation unavailable' });
  });

  it.each([NaN, Infinity, -Infinity, -1, '1', {}])('rejects invalid result %s', async (result) => {
    mocks.calculateETA.mockResolvedValueOnce(result);
    const res = response();
    await handler({ body: { distance: 10, speed: 50 } }, res);
    expect(res.statusCode).toBe(502);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'ETA calculation returned an invalid result' });
  });

  it.each([0, 0.2, 5, 1000000])('preserves finite nonnegative result %s', async (result) => {
    mocks.calculateETA.mockResolvedValueOnce(result);
    const res = response();
    await handler({ body: { distance: '10', speed: '50', trafficFactor: '0.5' } }, res);
    expect(mocks.calculateETA).toHaveBeenCalledWith(10, 50, 0.5);
    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: result }));
  });

  it.each([
    { distance: 0, speed: 50 }, { distance: -1, speed: 50 }, { distance: Infinity, speed: 50 },
    { distance: 10, speed: 0 }, { distance: 10, speed: -1 }, { distance: 10, speed: NaN },
    { distance: 10, speed: 50, trafficFactor: 1 }, { distance: 10, speed: 50, trafficFactor: Infinity }
  ])('preserves400 input rejection: %j', async (body) => {
    const res = response();
    await handler({ body }, res);
    expect(res.statusCode).toBe(400);
    expect(mocks.calculateETA).not.toHaveBeenCalled();
  });

  it('rejects overflow from the actual native fallback', async () => {
    vi.stubEnv('WASM_MODULE_PATH', '/private/tmp/truxify-eta-nonexistent-fixture.wasm');
    const { default: actualRuntime } = await vi.importActual('../../../../wasm/edge-runtime.js');
    await actualRuntime.initialize();
    mocks.calculateETA.mockImplementationOnce(actualRuntime.calculateETA.bind(actualRuntime));
    const res = response();
    await handler({ body: { distance: 1e308, speed: 1, trafficFactor: 0.9 } }, res);
    expect(res.statusCode).toBe(502);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
