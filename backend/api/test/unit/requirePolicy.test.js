import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requirePolicy } from '../../src/middleware/requirePolicy.js';
import { policy } from '../../src/security/policyEngine.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('requirePolicy Middleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requirePolicy is a function', async () => {
    const mod = await import('../../src/middleware/requirePolicy.js');
    expect(typeof mod.requirePolicy).toBe('function');
  });

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

  it('throws at construction time for an empty action', () => {
    expect(() => requirePolicy('')).toThrow(/non-empty action/);
    expect(() => requirePolicy('   ')).toThrow(/non-empty action/);
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

  it('returns 403 when resolver yields an undefined resource for an ownership-only action', async () => {
    const middleware = requirePolicy('order:view-driver-location', async () => ({ order: undefined }));
    const mockReq = { user: { id: 'user-1', role: 'customer' } };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const mockNext = vi.fn();

    middleware(mockReq, mockRes, mockNext);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 500 when the resource resolver rejects', async () => {
    const middleware = requirePolicy('order:view-driver-location', async () => {
      throw new Error('boom');
    });
    const mockReq = { user: { id: 'user-1', role: 'customer' } };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const mockNext = vi.fn();

    middleware(mockReq, mockRes, mockNext);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
