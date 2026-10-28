import { describe, it, expect, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

import { requirePolicy } from '../../src/middleware/requirePolicy.js';
import { policy } from '../../src/security/policyEngine.js';

describe('requirePolicy Middleware', () => {
  it('returns 401 if req.user is missing', () => {
    const middleware = requirePolicy('READ');
    const mockReq = {};
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const mockNext = vi.fn();

    middleware(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Not authenticated: req.user is missing.' });
  });

  it('calls next if policy authorization succeeds without resource', () => {
    vi.spyOn(policy, 'authorize').mockImplementation(() => {});
    const middleware = requirePolicy('ANY_ACTION');
    const mockReq = { user: { id: 'user-1', role: 'admin' } };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const mockNext = vi.fn();

    middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('returns a controlled 500 and logs when an ownership-only policy has no resolver', () => {
    const middleware = requirePolicy('order:view');
    const mockReq = { user: { id: 'user-1', role: 'customer' }, id: 'req-1' };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const mockNext = vi.fn();

    expect(() => middleware(mockReq, mockRes, mockNext)).not.toThrow();

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Misconfigured policy 'order:view': ownership-only policies require a getResource resolver.",
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      {
        requestId: 'req-1',
        message: "Misconfigured policy 'order:view': ownership-only policies require a getResource resolver.",
      },
      '[requirePolicy] Policy enforcement error'
    );
    expect(mockNext).not.toHaveBeenCalled();
  });
});
