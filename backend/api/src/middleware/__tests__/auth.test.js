import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requireRole } from '../auth.js';

describe('requireRole Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            requestId: 'req-123',
            user: null
        };
        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        };
        next = vi.fn();
    });

    it('should throw an error if allowedRoles is not an array', () => {
        expect(() => requireRole('admin')).toThrow('requireRole middleware requires a non-empty array of allowed roles.');
    });

    it('should throw an error if allowedRoles is an empty array', () => {
        expect(() => requireRole([])).toThrow('requireRole middleware requires a non-empty array of allowed roles.');
    });

    it('should return 401 Unauthorized if req.user is missing', () => {
        req.user = null;
        const middleware = requireRole(['admin', 'driver']);
        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: "Unauthorized: Authentication required.",
            hint: "Please provide a valid authentication token to access this resource."
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 Unauthorized if req.user is undefined', () => {
        req.user = undefined;
        const middleware = requireRole(['admin']);
        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: "Unauthorized: Authentication required.",
            hint: "Please provide a valid authentication token to access this resource."
        });
    });

    it('should return 403 Forbidden if user role is not in allowedRoles', () => {
        req.user = { id: 'user-1', role: 'customer' };
        const middleware = requireRole(['admin', 'driver']);
        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: "Forbidden: Insufficient privileges.",
            details: "Your account role 'customer' is not authorized to access this resource."
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('should call next() if user role is in allowedRoles', () => {
        req.user = { id: 'user-1', role: 'admin' };
        const middleware = requireRole(['admin', 'driver']);
        middleware(req, res, next);

        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
    });

    it('should handle roles with extra whitespace correctly', () => {
        req.user = { id: 'user-1', role: '  admin  ' };
        const middleware = requireRole(['admin']);
        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });
});
