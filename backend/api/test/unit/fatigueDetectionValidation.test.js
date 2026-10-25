import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { evaluateDriverFatigue } from '../../src/services/fatigueDetection.js';
import fatigueRouter from '../../src/routes/fatigueDetection.js';

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/fatigue-detection', fatigueRouter);
    return app;
}

describe('fatigue detection input validation', () => {
    it('rejects string biometric values instead of reporting normal alertness', async () => {
        const response = await request(makeApp())
            .post('/api/fatigue-detection/evaluate')
            .send({
                driverId: 'driver-bad-bio',
                biometricData: { perclosScore: 'abc', headNodCount: 'x' },
                hosRemainingMinutes: 'oops',
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/perclosScore|headNodCount|hosRemainingMinutes/);
    });

    it('rejects non-finite and out-of-range telemetry', async () => {
        const cases = [
            { perclosScore: -0.1 },
            { perclosScore: 1.1 },
            { blinkRatePerMin: '18' },
            { headNodCount: 1.5 },
            { averageEyeClosureMs: -1 },
        ];

        for (const biometricData of cases) {
            const response = await request(makeApp())
                .post('/api/fatigue-detection/evaluate')
                .send({ driverId: 'driver-range', biometricData, hosRemainingMinutes: 480 });
            expect(response.status, JSON.stringify(biometricData)).toBe(400);
        }

        const hosResponse = await request(makeApp())
            .post('/api/fatigue-detection/evaluate')
            .send({ driverId: 'driver-range', biometricData: {}, hosRemainingMinutes: 10081 });
        expect(hosResponse.status).toBe(400);
    });

    it('throws a 400 validation error from the service for non-numeric telemetry', () => {
        let thrown;
        try {
            evaluateDriverFatigue({ driverId: 'driver-service', biometricData: { perclosScore: '0.2' } });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(RangeError);
        expect(thrown.statusCode).toBe(400);
        expect(thrown.message).toMatch(/perclosScore/);
    });

    it('accepts valid boundary values', async () => {
        const response = await request(makeApp())
            .post('/api/fatigue-detection/evaluate')
            .send({
                driverId: 'driver-valid',
                biometricData: {
                    perclosScore: 1,
                    blinkRatePerMin: 120,
                    headNodCount: 1000,
                    averageEyeClosureMs: 60000,
                },
                hosRemainingMinutes: 10080,
            });

        expect(response.status).toBe(200);
        expect(response.body.data.fatigueMetrics.fatigueScore).toBe(1);
    });
});
