import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { default: authFailureMonitor } = await import('../../src/middleware/authFailureMonitor.js');

function makeReq(ip) {
  return { ip, method: 'POST', originalUrl: '/api/auth/login' };
}

function makeRes() {
  let finishHandler = null;
  return {
    statusCode: 401,
    on: vi.fn((event, handler) => {
      if (event === 'finish') finishHandler = handler;
    }),
    _finish() {
      if (finishHandler) finishHandler();
    },
  };
}

describe('authFailureMonitor bounded tracking', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'development';
    delete process.env.AUTH_FAILURE_THRESHOLD;
    delete process.env.AUTH_FAILURE_WINDOW_MS;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    delete process.env.AUTH_FAILURE_THRESHOLD;
    delete process.env.AUTH_FAILURE_WINDOW_MS;
  });

  it('warns when a single IP crosses the threshold', () => {
    const req = makeReq('10.0.0.1');
    const res = makeRes();
    const next = vi.fn();
    authFailureMonitor(req, res, next);
    for (let i = 0; i < 5; i += 1) res._finish();
    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockLogger.warn.mock.calls[0][0]).toMatchObject({ ip: '10.0.0.1' });
  });

  it('tracks distinct IPs independently without cross-contamination', () => {
    const res1 = makeRes();
    authFailureMonitor(makeReq('172.16.0.1'), res1, vi.fn());
    for (let i = 0; i < 4; i += 1) res1._finish();

    const res2 = makeRes();
    authFailureMonitor(makeReq('172.16.0.2'), res2, vi.fn());
    for (let i = 0; i < 4; i += 1) res2._finish();

    // Neither IP reached the threshold of 5 alone, so no warning yet.
    expect(mockLogger.warn).not.toHaveBeenCalled();

    res1._finish();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0][0]).toMatchObject({ ip: '172.16.0.1' });
  });

  it('calls next() to continue the chain', () => {
    const next = vi.fn();
    authFailureMonitor(makeReq('10.0.0.1'), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
