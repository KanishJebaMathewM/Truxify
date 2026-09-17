import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyPriceObfuscation } from '../priceObfuscation.js';

const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    single: vi.fn()
};

vi.mock('../../config/supabase.js', () => ({
    supabase: mockSupabase
}));

describe('Price Obfuscation Service', () => {
    beforeEach(() => {
        mockSupabase.single.mockReset();
    });

    it('should apply default small noise (1%) for anonymous users', async () => {
        const basePrice = 10000;
        const result = await applyPriceObfuscation(basePrice, null);

        // Noise should be exactly 1% for anonymous
        const minExpected = 10000 * 0.99;
        const maxExpected = 10000 * 1.01;

        expect(result).toBeGreaterThanOrEqual(minExpected);
        expect(result).toBeLessThanOrEqual(maxExpected);
    });

    it('should NOT apply noise for users with high conversion rate', async () => {
        const basePrice = 10000;
        const userId = 'user-high-conversion';

        mockSupabase.single.mockResolvedValue({
            data: { total_searches: 15, total_bookings: 10 }, // 66% conversion rate
            error: null
        });

        const result = await applyPriceObfuscation(basePrice, userId);
        expect(result).toBe(basePrice);
    });

    it('should NOT apply noise for users with low search volume', async () => {
        const basePrice = 10000;
        const userId = 'user-low-volume';

        mockSupabase.single.mockResolvedValue({
            data: { total_searches: 5, total_bookings: 0 }, // Below threshold of 10
            error: null
        });

        const result = await applyPriceObfuscation(basePrice, userId);
        expect(result).toBe(basePrice);
    });

    it('should apply noise (1% to 2%) for frequent searchers with low conversion rate', async () => {
        const basePrice = 10000;
        const userId = 'user-frequent-low-conversion';

        mockSupabase.single.mockResolvedValue({
            data: { total_searches: 20, total_bookings: 2 }, // 10% conversion rate (< 20%)
            error: null
        });

        const result = await applyPriceObfuscation(basePrice, userId);

        // Noise should be between 1% and 2%
        const minExpected = 10000 * 0.98; // Worst case -2%
        const maxExpected = 10000 * 1.02; // Best case +2%

        expect(result).toBeGreaterThanOrEqual(minExpected);
        expect(result).toBeLessThanOrEqual(maxExpected);
        expect(result).not.toBe(basePrice); // Must be different from base price due to noise
    });

    it('should handle database errors gracefully and return exact price (fail-safe)', async () => {
        const basePrice = 10000;
        const userId = 'user-db-error';

        mockSupabase.single.mockResolvedValue({
            data: null,
            error: new Error('Database connection failed')
        });

        const result = await applyPriceObfuscation(basePrice, userId);
        expect(result).toBe(basePrice);
    });

    it('should ensure obfuscated price does not drop below 90% of base price under any circumstance', async () => {
        const basePrice = 1000;
        const userId = 'user-extreme';

        mockSupabase.single.mockResolvedValue({
            data: { total_searches: 50, total_bookings: 1 },
            error: null
        });

        // Run multiple times to ensure the safeguard never fails
        for (let i = 0; i < 10; i++) {
            const result = await applyPriceObfuscation(basePrice, userId);
            expect(result).toBeGreaterThanOrEqual(basePrice * 0.9);
        }
    });

    it('should cache database results to prevent redundant queries', async () => {
        const basePrice = 10000;
        const userId = 'user-cached';

        mockSupabase.single.mockResolvedValue({
            data: { total_searches: 20, total_bookings: 2 },
            error: null
        });

        // First call hits DB
        await applyPriceObfuscation(basePrice, userId);
        expect(mockSupabase.single).toHaveBeenCalledTimes(1);

        // Second call should use cache
        await applyPriceObfuscation(basePrice, userId);
        expect(mockSupabase.single).toHaveBeenCalledTimes(1); // Still 1
    });
});
