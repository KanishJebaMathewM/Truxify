/**
 * @fileoverview Tests specifically targeting the pagination logic in FraudDetectionService.getFraudStats.
 * These tests verify that the `.range()` method is correctly utilized and handled by the Supabase mock.
 * Resolves Issue #10103.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FraudDetectionService } from '../../src/services/fraud/FraudDetectionService.js';
import { createSupabaseMock } from '../helpers/supabaseQueryMock.js';

// Mock the db config module to inject our robust mock
let mockSupabaseAdmin = null;
vi.mock('../../src/config/db.js', () => ({
    get supabaseAdmin() { return mockSupabaseAdmin; }
}));

import * as dbConfig from '../../src/config/db.js';

describe('FraudDetectionService.getFraudStats Pagination (#10103)', () => {
    let service;
    let mockFraudData;

    beforeEach(() => {
        // Generate 250 mock fraud events to test pagination boundaries
        mockFraudData = Array.from({ length: 250 }, (_, i) => ({
            id: `fraud-${i}`,
            user_id: `user-${i % 50}`,
            event_type: i % 2 === 0 ? 'velocity_spike' : 'geo_anomaly',
            severity: i % 3 === 0 ? 'high' : 'medium',
            created_at: new Date(Date.now() - i * 1000).toISOString()
        }));

        const mockClient = createSupabaseMock({
            tables: {
                fraud_stats: mockFraudData
            }
        });

        mockSupabaseAdmin = mockClient;
        service = new FraudDetectionService();
    });

    it('should successfully fetch the first page of fraud stats using .range(0, 49)', async () => {
        const result = await service.getFraudStats({ page: 1, limit: 50 });

        expect(result.error).toBeNull();
        expect(result.data).toBeDefined();
        expect(result.data.length).toBe(50);
        expect(result.data[0].id).toBe('fraud-0');
    });

    it('should successfully fetch the middle page using .range(50, 99)', async () => {
        const result = await service.getFraudStats({ page: 2, limit: 50 });

        expect(result.error).toBeNull();
        expect(result.data.length).toBe(50);
        expect(result.data[0].id).toBe('fraud-50');
    });

    it('should handle the last partial page correctly using .range(200, 249)', async () => {
        const result = await service.getFraudStats({ page: 5, limit: 50 });

        expect(result.error).toBeNull();
        expect(result.data.length).toBe(50);
        expect(result.data[0].id).toBe('fraud-200');
    });

    it('should return empty array when requesting a page beyond the dataset', async () => {
        const result = await service.getFraudStats({ page: 10, limit: 50 });

        expect(result.error).toBeNull();
        expect(result.data.length).toBe(0);
    });

    it('should apply filters before applying the range pagination', async () => {
        // Filter for high severity only (84 items out of 250)
        const result = await service.getFraudStats({
            page: 1,
            limit: 20,
            filters: { severity: 'high' }
        });

        expect(result.error).toBeNull();
        expect(result.data.length).toBe(20);
        result.data.forEach(event => {
            expect(event.severity).toBe('high');
        });
    });

    it('should apply ordering before applying the range pagination', async () => {
        // Order by created_at ascending (oldest first)
        const result = await service.getFraudStats({
            page: 1,
            limit: 10,
            orderBy: { column: 'created_at', ascending: true }
        });

        expect(result.error).toBeNull();
        expect(result.data.length).toBe(10);

        // The oldest event in our generated data is the last one (highest index)
        expect(result.data[0].id).toBe('fraud-249');
    });

    it('should not throw TypeError when .range() is called on the query builder', async () => {
        // This is the exact regression test for Issue #10103
        await expect(service.getFraudStats({ page: 1, limit: 50 }))
            .resolves.not.toThrow();
    });

    it('should handle Supabase errors gracefully during paginated reads', async () => {
        const errorClient = createSupabaseMock({
            tables: { fraud_stats: [] },
            errors: { fraud_stats: { code: '42P01', message: 'relation "fraud_stats" does not exist' } }
        });
        mockSupabaseAdmin = errorClient;

        const errorService = new FraudDetectionService();
        const result = await errorService.getFraudStats({ page: 1, limit: 50 });

        expect(result.error).toBeDefined();
        expect(result.error.code).toBe('42P01');
        expect(result.data).toBeNull();
    });

    it('should default to page 1 and limit 50 if parameters are omitted', async () => {
        const result = await service.getFraudStats();

        expect(result.error).toBeNull();
        expect(result.data.length).toBe(50);
    });

    it('should clamp negative page numbers to page 1', async () => {
        const result = await service.getFraudStats({ page: -5, limit: 50 });

        expect(result.error).toBeNull();
        expect(result.data.length).toBe(50);
        expect(result.data[0].id).toBe('fraud-0');
    });
});
