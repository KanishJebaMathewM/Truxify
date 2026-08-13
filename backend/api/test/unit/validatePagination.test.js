import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let logger;
beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});

function makeReq(q = {}) { return { query: { ...q } }; }
function makeRes() {
  const h = {};
  return {
    getHeader: vi.fn(n => h[n]),
    setHeader: vi.fn((n, v) => { h[n] = v; }),
    json: vi.fn(function(b) { return this; }),
    on: vi.fn(),
  };
}

describe('validatePagination', () => {
  let vp;
  beforeEach(async () => {
    const mod = await import('../../src/middleware/pagination.js');
    vp = mod.validatePagination;
  });

  it('defaults limit=10 offset=0', async () => {
    const req = makeReq(), res = makeRes(), next = vi.fn();
    vp()(req, res, next);
    expect(req.pagination.limit).toBe(10);
    expect(req.pagination.offset).toBe(0);
  });

  it('caps limit at 100', async () => {
    const req = makeReq({ limit: '999' }), res = makeRes(), next = vi.fn();
    vp()(req, res, next);
    expect(req.pagination.limit).toBe(100);
  });

  it('returns 400 for non-numeric limit', async () => {
    const req = makeReq({ limit: 'abc' }), res = makeRes(), next = vi.fn();
    vp()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('computes page offset correctly', async () => {
    const req = makeReq({ page: '3', limit: '10' }), res = makeRes(), next = vi.fn();
    vp()(req, res, next);
    expect(req.pagination.offset).toBe(20);
  });

  it('caps offset at 10000', async () => {
    const req = makeReq({ offset: '50000' }), res = makeRes(), next = vi.fn();
    vp()(req, res, next);
    expect(req.pagination.offset).toBe(10000);
  });
});
