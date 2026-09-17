/**
 * Unit Tests for requireRole middleware
 * 
 * Verifies that missing req.user returns 401 (not 501),
 * and insufficient roles return 403.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireRole } from '../../../src/middleware/auth.js';
import { createMockRequest, createMockResponse, createMockNext, createMockUser } from '../../fixtures/authFixtures.js';

vi.mock('../../../src/middleware/logger.js', () => ({
    default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

describe('requireRole middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = createMockRequest();
        res = createMockResponse();
        next = createMockNext();
        vi.clearAllMocks();
    });

    it('should throw an error if allowedRoles is not an array', () => {
        expect(() => requireRole('admin')).toThrow('requireRole middleware requires a non-empty array of allowed roles.');
        expect(() => requireRole([])).toThrow('requireRole middleware requires a non-empty array of allowed roles.');
    });

    it('should throw an error if allowedRoles array contains no valid strings', () => {
        expect(() => requireRole([null, undefined, 123])).toThrow('requireRole middleware requires at least one non-empty role string.');
    });

    it('should return HTTP 401 when req.user is missing (FIX VERIFICATION)', () => {
        // Ensure req.user is explicitly undefined/null
        req.user = undefined;

        const middleware = requireRole(['admin', 'driver']);
        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: "Not authenticated: req.user is missing."
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('should return HTTP 401 when req.user is null (FIX VERIFICATION)', () => {
        req.user = null;

        const middleware = requireRole(['admin']);
        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('should return HTTP 403 when user role is not in allowed list', () => {
        req.user = createMockUser({ role: 'customer' });

        const middleware = requireRole(['admin', 'driver']);
        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: "Forbidden: Insufficient privileges."
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('should call next() when user role is in allowed list', () => {
        req.user = createMockUser({ role: 'admin' });

        const middleware = requireRole(['admin', 'driver']);
        middleware(req, res, next);

        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
    });

    it('should handle roles with extra whitespace gracefully', () => {
        req.user = createMockUser({ role: '  admin  ' });

        const middleware = requireRole(['admin']);
        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });
});
