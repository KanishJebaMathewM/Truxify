import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { calculateFairMarketValue } from '../../src/services/pricingOracle.js';
import pricingRouter from '../../src/routes/pricingOracle.js';

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/pricing-oracle', pricingRouter);
    return app;
}

const validLoad = { distanceMiles: 100, equipmentType: 'DRY_VAN', currentOfferedPayout: 235 };

describe('pricing oracle input validation', () => {
    it('rejects string, zero, and negative load amounts', async () => {
        const loads = [
            { ...validLoad, currentOfferedPayout: 'abc' },
            { ...validLoad, currentOfferedPayout: 0 },
            { ...validLoad, currentOfferedPayout: -50 },
            { ...validLoad, distanceMiles: '100' },
            { ...validLoad, distanceMiles: 0 },
            { ...validLoad, distanceMiles: -100 },
        ];

        for (const load of loads) {
            const response = await request(makeApp())
                .post('/api/pricing-oracle/evaluate-load')
                .send({ load });
            expect(response.status, JSON.stringify(load)).toBe(400);
        }
    });

    it('rejects non-positive or non-finite market conditions', async () => {
        const marketConditionsList = [
            { truckToLoadRatio: 0 },
            { truckToLoadRatio: -1 },
            { truckToLoadRatio: 'abc' },
            { localFuelPriceUSD: 0 },
            { localFuelPriceUSD: -2 },
            { localFuelPriceUSD: 'abc' },
        ];

        for (const marketConditions of marketConditionsList) {
            const response = await request(makeApp())
                .post('/api/pricing-oracle/evaluate-load')
                .send({ load: validLoad, marketConditions });
            expect(response.status, JSON.stringify(marketConditions)).toBe(400);
        }
    });

    it('throws a validation error instead of a TypeError for a string payout', () => {
        let thrown;
        try {
            calculateFairMarketValue({ distanceMiles: 100, currentOfferedPayout: 'abc' });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(RangeError);
        expect(thrown.statusCode).toBe(400);
        expect(thrown.message).toMatch(/currentOfferedPayout/);
    });

    it('accepts a valid valuation request', async () => {
        const response = await request(makeApp())
            .post('/api/pricing-oracle/evaluate-load')
            .send({ load: validLoad, marketConditions: { truckToLoadRatio: 1, localFuelPriceUSD: 3.9 } });

        expect(response.status).toBe(200);
        expect(response.body.data.oracleValuation.fairMarketValueUSD).toBe(235);
    });
});
