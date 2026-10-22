import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
    MAX_DWELL_RECORDS,
    MAX_SLOTS_PER_FACILITY,
    MAX_YARD_PINS,
    YARD_PIN_TTL_MS,
    allocateYardSlot,
    locateTrailerInYard,
    recordTrailerDrop,
    registerYardSlot,
    resetYardState,
} from '../../src/services/ymsTracker.js';
import ymsRouter from '../../src/routes/ymsTracker.js';

const facilityId = 'FAC-BOUNDS-01';

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/yms', ymsRouter);
    return app;
}

function drop(trailerId) {
    return recordTrailerDrop({
        trailerId,
        driverId: 'driver-1',
        facilityId,
        latitude: 41.974,
        longitude: -87.907,
    });
}

describe('ymsTracker in-memory store bounds', () => {
    beforeEach(() => {
        resetYardState();
    });

    afterEach(() => {
        vi.useRealTimers();
        resetYardState();
    });

    it('expires old yard pins before recording a new one', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

        drop('TRAILER-OLD');
        vi.advanceTimersByTime(YARD_PIN_TTL_MS + 1);
        drop('TRAILER-NEW');

        expect(locateTrailerInYard('TRAILER-OLD').found).toBe(false);
        expect(locateTrailerInYard('TRAILER-NEW').found).toBe(true);
    });

    it('rejects new pins once the documented pin cap is reached', () => {
        for (let i = 0; i < MAX_YARD_PINS; i++) {
            drop(`TRAILER-${i}`);
        }

        let thrown;
        try {
            drop('TRAILER-OVERFLOW');
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeDefined();
        expect(thrown.code).toBe('YMS_CAPACITY');
        expect(thrown.statusCode).toBe(429);
        expect(thrown.message).toMatch(/pin capacity reached/);
    });

    it('rejects new slots once the per-facility cap is reached', () => {
        for (let i = 0; i < MAX_SLOTS_PER_FACILITY; i++) {
            registerYardSlot(facilityId, { slotId: `SLOT-${i}` });
        }

        expect(() => registerYardSlot(facilityId, { slotId: 'SLOT-OVERFLOW' }))
            .toThrow(/slot capacity reached/);
    });

    it('rejects new dwell records once the dwell cap is reached', () => {
        for (let i = 0; i < MAX_DWELL_RECORDS; i++) {
            registerYardSlot(facilityId, { slotId: `DWELL-SLOT-${i}` });
        }
        for (let i = 0; i < MAX_DWELL_RECORDS; i++) {
            const result = allocateYardSlot(facilityId, { trailerId: `DWELL-TRAILER-${i}` });
            expect(result.allocated).toBe(true);
        }

        expect(() => allocateYardSlot(facilityId, { trailerId: 'DWELL-TRAILER-OVERFLOW' }))
            .toThrow(/dwell capacity reached/);
    });

    it('returns 429 from the drop-pin route when the pin store is full', async () => {
        for (let i = 0; i < MAX_YARD_PINS; i++) {
            drop(`ROUTE-TRAILER-${i}`);
        }

        const response = await request(makeApp())
            .post('/api/yms/drop-pin')
            .send({ trailerId: 'ROUTE-TRAILER-OVERFLOW', latitude: 41.974, longitude: -87.907 });

        expect(response.status).toBe(429);
        expect(response.body.error).toMatch(/pin capacity reached/);
    });
});
