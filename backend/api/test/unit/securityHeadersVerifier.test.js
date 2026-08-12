import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let logger;

beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
  process.env.NODE_ENV = 'test';
});

function makeReq(overrides = {}) {
  return { method: 'GET', originalUrl: '/api/test', ...overrides };
}

function makeRes() {
  const hdrs = {};
  return {
    getHeader: vi.fn(n => hdrs[n]),
    setHeader: vi.fn((n, v) => { hdrs[n] = v; }),
    on: vi.fn(),
  };
}

describe('securityHeadersVerifier', () => {
  let sv;

  beforeEach(async () => {
    const mod = await import('../../src/middleware/securityHeadersVerifier.js');
    sv = mod.default;
  });

  it('skips logging in production', async () => {
    process.env.NODE_ENV = 'production';
    const req = makeReq(), res = makeRes(), next = vi.fn();
    sv(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.on).not.toHaveBeenCalled();
    process.env.NODE_ENV = 'test';
  });

  it('calls next in non-production', async () => {
    process.env.NODE_ENV = 'test';
    const req = makeReq(), res = makeRes(), next = vi.fn();
    sv(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });
});
