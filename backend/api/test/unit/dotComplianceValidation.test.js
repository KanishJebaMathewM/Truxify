import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
    evaluateDriverCompliance,
} from '../../src/services/dotCompliance.js';
import dotComplianceRouter from '../../src/routes/dotCompliance.js';

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/dot-compliance', dotComplianceRouter);
    return app;
}

const futureDate = () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

describe('DOT compliance input validation', () => {
    it('rejects an unparseable expiration date instead of reporting the driver compliant', async () => {
        const response = await request(makeApp())
            .post('/api/dot-compliance/evaluate')
            .send({
                driverId: 'driver-invalid-date',
                cdlExpiration: 'not-a-date',
                medicalCardExpiration: futureDate(),
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cdlExpiration/);
    });

    it('rejects empty expiration strings and whitespace-only driver IDs', async () => {
        const emptyDate = await request(makeApp())
            .post('/api/dot-compliance/evaluate')
            .send({ driverId: 'driver-empty-date', cdlExpiration: '' });
        expect(emptyDate.status).toBe(400);

        const blankDriver = await request(makeApp())
            .post('/api/dot-compliance/evaluate')
            .send({ driverId: '   ', cdlExpiration: futureDate() });
        expect(blankDriver.status).toBe(400);
        expect(blankDriver.body.error).toMatch(/driverId/);
    });

    it('throws a 400 validation error from the service for invalid dates', () => {
        let thrown;
        try {
            evaluateDriverCompliance({ driverId: 'driver-service', medicalCardExpiration: 'invalid' });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(RangeError);
        expect(thrown.statusCode).toBe(400);
        expect(thrown.message).toMatch(/medicalCardExpiration/);
    });

    it('still accepts a fully valid compliance payload', async () => {
        const response = await request(makeApp())
            .post('/api/dot-compliance/evaluate')
            .send({
                driverId: 'driver-valid',
                cdlExpiration: futureDate(),
                medicalCardExpiration: futureDate(),
                hazmatExpiration: futureDate(),
            });

        expect(response.status).toBe(200);
        expect(response.body.data.isFullyCompliant).toBe(true);
    });
});
