/**
 * Escrow Webhook Database Mocks
 * 
 * Standardizes the chaining behavior of Supabase mock queries for webhook tests.
 */
import { vi } from 'vitest';

export function createChainableMock(result) {
    const q = {
        select: vi.fn(() => q),
        eq: vi.fn(() => q),
        in: vi.fn(() => q),
        maybeSingle: vi.fn(() => Promise.resolve(result)),
        update: vi.fn(() => q),
        then: (resolve) => resolve(result.data ? { data: [result.data], error: result.error } : result),
    };
    return q;
}

export function setupDbMock(dbMock, result) {
    const q = createChainableMock(result);
    dbMock.supabaseAdmin.from.mockReturnValue(q);
    return q;
}
