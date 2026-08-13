import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { default: suspiciousRequests } = await import('../../src/middleware/suspiciousRequests.js');

function makeReq(overrides = {}) {
  return {
    headers: {},
    query: {},
    body: {},
    originalUrl: '/api/test',
    requestId: 'req-1',
    ip: '10.0.0.1',
    method: 'GET',
    ...overrides,
  };
}

describe('suspiciousRequests user-agent handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('truncates a long user-agent string in the warning payload', () => {
    const longUa = 'sqlmap/' + 'x'.repeat(500);
    const req = makeReq({ headers: { 'user-agent': longUa }, body: { q: 'select 1' } });
    const res = {};
    const next = vi.fn();
    suspiciousRequests(req, res, next);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userAgent: expect.stringMatching(/^sqlmap\/x{0,256}$/),
      }),
      'Suspicious request detected'
    );
    const payload = mockLogger.warn.mock.calls[0][0];
    expect(payload.userAgent.length).toBeLessThanOrEqual(256);
  });

  it('uses the first value when user-agent is a repeated array header', () => {
    const req = makeReq({
      headers: { 'user-agent': ['nikto/2.1', 'other-agent'] },
      body: { q: 'select 1' },
    });
    const res = {};
    const next = vi.fn();
    suspiciousRequests(req, res, next);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: 'nikto/2.1' }),
      'Suspicious request detected'
    );
  });
});
