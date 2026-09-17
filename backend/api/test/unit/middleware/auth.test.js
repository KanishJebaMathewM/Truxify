/**
 * Unit Tests for auth.js middleware (authenticate function)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticate } from '../../../src/middleware/auth.js';
import { createMockRequest, createMockResponse, createMockNext, createMockUser } from '../../fixtures/authFixtures.js';

vi.mock('../../../src/middleware/logger.js', () => ({
    default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

describe('authenticate middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = createMockRequest();
        res = createMockResponse();
        next = createMockNext();
        vi.clearAllMocks();
    });

    it('should call next() if req.user is already set', async () => {
        req.user = createMockUser();
        await authenticate(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 401 if no authorization header is provided', async () => {
        await authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: "Access Denied. No token provided."
        }));
    });

    it('should return 401 if authorization header does not start with Bearer', async () => {
        req.headers.authorization = 'Basic abc123';
        await authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
