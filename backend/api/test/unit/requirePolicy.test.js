import { describe, it, expect, vi } from 'vitest';
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
});
