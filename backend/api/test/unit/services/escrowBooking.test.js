/**
 * @fileoverview Unit tests for getEscrowBooking function.
 * Resolves Issue #7340: Verifies the exported function exists and works correctly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Supabase client
const mockSupabase = {
    from: vi.fn(() => mockSupabase),
    select: vi.fn(() => mockSupabase),
    eq: vi.fn(() => mockSupabase),
    maybeSingle: vi.fn()
};

vi.mock('../../../src/config/db.js', () => ({
    supabaseAdmin: mockSupabase,
    supabase: mockSupabase
}));

import { getEscrowBooking } from '../../../src/services/escrow.js';

describe('getEscrowBooking (#7340)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should be exported from escrow.js', () => {
        expect(typeof getEscrowBooking).toBe('function');
    });

    it('should query escrow_bookings table by ID', async () => {
        const mockBooking = {
            id: 'booking-123',
            order_display_id: 'TRX-8842',
            amount_wei: '1000000000000000000',
            status: 'funded',
            tx_hash: '0xabc...',
            created_at: '2026-09-17T10:00:00Z'
        };

        mockSupabase.maybeSingle.mockResolvedValue({
            data: mockBooking,
            error: null
        });

        const result = await getEscrowBooking('booking-123');

        expect(mockSupabase.from).toHaveBeenCalledWith('escrow_bookings');
        expect(mockSupabase.select).toHaveBeenCalled();
        expect(mockSupabase.eq).toHaveBeenCalledWith('id', 'booking-123');
        expect(result).toEqual(mockBooking);
    });

    it('should return null when booking not found', async () => {
        mockSupabase.maybeSingle.mockResolvedValue({
            data: null,
            error: null
        });

        const result = await getEscrowBooking('non-existent-id');
        expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
        const dbError = { code: 'PGRST116', message: 'Connection lost' };
        mockSupabase.maybeSingle.mockResolvedValue({
            data: null,
            error: dbError
        });

        await expect(getEscrowBooking('booking-123')).rejects.toThrow();
    });

    it('should handle empty string booking ID gracefully', async () => {
        mockSupabase.maybeSingle.mockResolvedValue({
            data: null,
            error: null
        });

        const result = await getEscrowBooking('');
        expect(result).toBeNull();
    });

    it('should handle null booking ID gracefully', async () => {
        mockSupabase.maybeSingle.mockResolvedValue({
            data: null,
            error: null
        });

        const result = await getEscrowBooking(null);
        expect(result).toBeNull();
    });

    it('should handle undefined booking ID gracefully', async () => {
        mockSupabase.maybeSingle.mockResolvedValue({
            data: null,
            error: null
        });

        const result = await getEscrowBooking(undefined);
        expect(result).toBeNull();
    });

    it('should return full booking record with all fields', async () => {
        const fullBooking = {
            id: 'booking-456',
            order_display_id: 'TRX-9921',
            amount_wei: '2500000000000000000',
            token_address: '0x123...',
            payer_address: '0xabc...',
            payee_address: '0xdef...',
            status: 'pending_confirmation',
            tx_hash: null,
            confirmed_at: null,
            created_at: '2026-09-17T12:00:00Z',
            updated_at: '2026-09-17T12:00:00Z'
        };

        mockSupabase.maybeSingle.mockResolvedValue({
            data: fullBooking,
            error: null
        });

        const result = await getEscrowBooking('booking-456');

        expect(result).toEqual(fullBooking);
        expect(result.token_address).toBeDefined();
        expect(result.payer_address).toBeDefined();
        expect(result.payee_address).toBeDefined();
    });
});
