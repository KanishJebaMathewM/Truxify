import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
    simulateThermodynamicPulldown,
} from '../../src/services/reeferPrecool.js';
import reeferRouter from '../../src/routes/reeferPrecool.js';

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/reefer-precool', reeferRouter);
    return app;
}

describe('reefer precool input validation', () => {
    it('rejects non-numeric simulation temperatures with 400 instead of throwing', async () => {
        const response = await request(makeApp())
            .post('/api/reefer-precool/simulate-pulldown')
            .send({ initialTempF: 'abc', targetTempF: 0, ambientTempF: 90 });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/initialTempF/);
    });

    it('rejects invalid evaluation temperatures and negative ETA values', async () => {
        const payloads = [
            { etaMinutes: 60, targetCargoTempF: 'NaN', currentReeferTempF: 75, ambientWeatherTempF: 95 },
            { etaMinutes: -1, targetCargoTempF: 0, currentReeferTempF: 75, ambientWeatherTempF: 95 },
            { etaMinutes: 60, targetCargoTempF: -100, currentReeferTempF: 75, ambientWeatherTempF: 95 },
            { etaMinutes: 60, targetCargoTempF: 0, currentReeferTempF: 75, ambientWeatherTempF: 200 },
        ];

        for (const payload of payloads) {
            const response = await request(makeApp())
                .post('/api/reefer-precool/evaluate-precool')
                .send({ reeferId: 'REEFER-BAD', ...payload });
            expect(response.status, JSON.stringify(payload)).toBe(400);
        }
    });

    it('rejects unknown insulation and reefer modes', async () => {
        const invalidInsulation = await request(makeApp())
            .post('/api/reefer-precool/simulate-pulldown')
            .send({ initialTempF: 75, targetTempF: 0, insulationRating: 'MAGIC' });
        expect(invalidInsulation.status).toBe(400);

        const invalidMode = await request(makeApp())
            .post('/api/reefer-precool/simulate-pulldown')
            .send({ initialTempF: 75, targetTempF: 0, reeferMode: 'TURBO' });
        expect(invalidMode.status).toBe(400);
    });

    it('throws a 400 validation error from the service for a string temperature', () => {
        let thrown;
        try {
            simulateThermodynamicPulldown({ initialTempF: 'abc', targetTempF: 0 });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(RangeError);
        expect(thrown.statusCode).toBe(400);
        expect(thrown.message).toMatch(/initialTempF/);
    });

    it('accepts valid temperature and ETA boundaries', async () => {
        const response = await request(makeApp())
            .post('/api/reefer-precool/evaluate-precool')
            .send({
                reeferId: 'REEFER-VALID',
                etaMinutes: 10080,
                targetCargoTempF: -80,
                currentReeferTempF: 150,
                ambientWeatherTempF: 150,
            });

        expect(response.status).toBe(200);
        expect(response.body.data.reeferId).toBe('REEFER-VALID');
    });
});
