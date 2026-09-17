/**
 * Authentication Test Fixtures
 * 
 * Provides standardized mock user objects and request contexts for middleware testing.
 */

export const createMockUser = (overrides = {}) => ({
    id: 'usr_123456789',
    uid: 'fb_uid_987654321',
    role: 'customer',
    fullName: 'Test User',
    phone: '+1234567890',
    isActive: true,
    ...overrides,
});

export const createMockRequest = (overrides = {}) => ({
    headers: {},
    ip: '127.0.0.1',
    requestId: 'req_abc123',
    ...overrides,
});

export const createMockResponse = () => {
    const res = {};
    res.status = vi.fn().mockReturnThis();
    res.json = vi.fn().mockReturnThis();
    return res;
};

export const createMockNext = () => vi.fn();
