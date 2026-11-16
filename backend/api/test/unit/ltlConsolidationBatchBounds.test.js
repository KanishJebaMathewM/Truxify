import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
    MAX_LTL_PARTIAL_LOADS,
    matchLtlPartialLoads,
} from '../../src/services/ltlConsolidation.js';
import ltlRouter from '../../src/routes/ltlConsolidation.js';

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/ltl-consolidation', ltlRouter);
    return app;
}

function makeLoads(count) {
    return Array.from({ length: count }, (_, i) => ({
        id: `LOAD-${i}`,
        requiredLinearFeet: 1,
        requiredWeightLbs: 100,
        estimatedDetourMinutes: 0,
        payoutUSD: 100,
    }));
}

const truck = {
    id: 'TRUCK-LTL-BOUNDS',
    remainingLinearFeet: 24,
    remainingWeightLbs: 18000,
    maxDelayMinutesTolerance: 60,
};

describe('LTL consolidation batch bounds', () => {
    it('rejects an oversized match batch with 413 before matching', async () => {
        const response = await request(makeApp())
            .post('/api/ltl-consolidation/match')
            .send({ truck, partialLoads: makeLoads(MAX_LTL_PARTIAL_LOADS + 1) });

        expect(response.status).toBe(413);
        expect(response.body.error).toMatch(/at most 100 loads/);
    });

    it('rejects an oversized optimize batch with 413 before branch-and-bound runs', async () => {
        const response = await request(makeApp())
            .post('/api/ltl-consolidation/optimize')
            .send({ truck, partialLoads: makeLoads(MAX_LTL_PARTIAL_LOADS + 1) });

        expect(response.status).toBe(413);
        expect(response.body.error).toMatch(/at most 100 loads/);
    });

    it('enforces the same cap in the service for direct callers', () => {
        let thrown;
        try {
            matchLtlPartialLoads(truck, makeLoads(MAX_LTL_PARTIAL_LOADS + 1));
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(RangeError);
        expect(thrown.statusCode).toBe(413);
    });

    it('accepts a batch exactly at the documented limit', async () => {
        const response = await request(makeApp())
            .post('/api/ltl-consolidation/match')
            .send({ truck, partialLoads: makeLoads(MAX_LTL_PARTIAL_LOADS) });

        expect(response.status).toBe(200);
        expect(response.body.data.matchedCount).toBe(MAX_LTL_PARTIAL_LOADS);
    });
});
