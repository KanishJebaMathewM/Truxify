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

function makeReq(overrides = {}) {
  return {
    ip: '10.0.0.1',
    method: 'POST',
    originalUrl: '/api/auth/login',
    requestId: 'req-123',
    ...overrides,
  };
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

function simulateFailures(count, { env = {}, reqOverrides = {} } = {}) {
  const next = vi.fn();
  const req = makeReq(reqOverrides);
  const res = makeRes();
  authFailureMonitor(req, res, next);
  for (let i = 0; i < count; i += 1) {
    res._finish();
  }
  return { next, mockLogger };
}

describe('authFailureMonitor env clamping', () => {
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

  it('skips monitoring entirely in test environment', () => {
    process.env.NODE_ENV = 'test';
    const { next } = simulateFailures(10);
    expect(next).toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('uses the default threshold when env is invalid (zero)', () => {
    process.env.AUTH_FAILURE_THRESHOLD = '0';
    simulateFailures(5);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('uses the default threshold when env is not a number', () => {
    process.env.AUTH_FAILURE_THRESHOLD = 'abc';
    simulateFailures(5);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('uses the default window when env is below the 1s floor', () => {
    process.env.AUTH_FAILURE_WINDOW_MS = '100';
    // 5 rapid failures with a clamped window must still trip the threshold
    simulateFailures(5);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('includes requestId in the structured warning payload', () => {
    simulateFailures(5);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-123', ip: '10.0.0.1' }),
      expect.any(String),
    );
  });
});
