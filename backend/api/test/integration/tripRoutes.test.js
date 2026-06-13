import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
    supabase: m.supabase,
    firebaseAdmin: null,
    redisClient: null,
    mongoDb: null,
}));

const { default: tripRouter } = await import('../../src/routes/tripRoutes.js');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/trips', tripRouter);
    return app;
}

const DRIVER_HEADERS = {
    'x-user-id': 'driver-1',
    'x-user-role': 'driver',
};

const validPayload = {
    idempotencyKey: 'batch-1',
    events: [
        {
            id: 'event-1',
            trip_id: 'trip-1',
            type: 'location_update',
            occurred_at: new Date().toISOString(),
            payload: {
                lat: 19.076,
                lng: 72.8777,
                speed: 40,
            },
            retry_count: 0,
        },
    ],
};

describe('Trip Routes', () => {
    beforeEach(() => {
        m.store.trip_events = [];
        m.store.processed_batches = [];
        m.calls.length = 0;
    });

    it('POST /events/batch returns 401 without auth headers', async () => {
        const res = await request(buildApp())
            .post('/api/v1/trips/events/batch')
            .send(validPayload);

        expect(res.status).toBe(401);
    });

    it('POST /events/batch returns 422 for missing idempotencyKey', async () => {
        const res = await request(buildApp())
            .post('/api/v1/trips/events/batch')
            .set(DRIVER_HEADERS)
            .send({
                events: validPayload.events,
            });

        expect(res.status).toBe(422);
        expect(res.body.error).toBe('Unprocessable Entity: Malformed batch payload');
        expect(res.body.details).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    field: 'idempotencyKey',
                }),
            ])
        );
    });

    it('POST /events/batch returns 422 for invalid event date', async () => {
        const res = await request(buildApp())
            .post('/api/v1/trips/events/batch')
            .set(DRIVER_HEADERS)
            .send({
                idempotencyKey: 'batch-invalid-date',
                events: [
                    {
                        id: 'event-1',
                        trip_id: 'trip-1',
                        type: 'location_update',
                        occurred_at: 'invalid-date',
                        payload: {},
                    },
                ],
            });

        expect(res.status).toBe(422);
        expect(res.body.error).toBe('Unprocessable Entity: Malformed batch payload');
        expect(res.body.details).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    field: 'events.0.occurred_at',
                }),
            ])
        );
    });

    it('POST /events/batch returns 200 for empty event batch', async () => {
        const res = await request(buildApp())
            .post('/api/v1/trips/events/batch')
            .set(DRIVER_HEADERS)
            .send({
                idempotencyKey: 'empty-batch',
                events: [],
            });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Empty batch received, nothing to process.');
    });

    it('POST /events/batch returns 202 when batch was already processed', async () => {
        m.store.processed_batches.push({
            id: 'batch-row-1',
            idempotency_key: 'batch-1',
            user_id: 'driver-1',
        });

        const res = await request(buildApp())
            .post('/api/v1/trips/events/batch')
            .set(DRIVER_HEADERS)
            .send(validPayload);

        expect(res.status).toBe(202);
        expect(res.body.message).toBe('Batch already processed.');
    });

    it('POST /events/batch inserts trip events and logs processed batch', async () => {
        const originalFrom = m.supabase.from.bind(m.supabase);

        m.supabase.from = table => {
            const builder = originalFrom(table);

            if (table === 'trip_events') {
                builder.upsert = vi.fn(async payload => {
                    m.calls.push({
                        table: 'trip_events',
                        mode: 'upsert',
                        payload,
                    });

                    m.store.trip_events.push(...payload);

                    return {
                        data: payload,
                        error: null,
                    };
                });
            }

            return builder;
        };

        const res = await request(buildApp())
            .post('/api/v1/trips/events/batch')
            .set(DRIVER_HEADERS)
            .send(validPayload);

        m.supabase.from = originalFrom;

        expect(res.status).toBe(202);
        expect(res.body.message).toBe('Batch processed successfully');
        expect(res.body.processed_count).toBe(1);

        const upsertCall = m.calls.find(
            c => c.table === 'trip_events' && c.mode === 'upsert'
        );

        expect(upsertCall).toBeTruthy();
        expect(upsertCall.payload[0]).toEqual(
            expect.objectContaining({
                event_id: 'event-1',
                user_id: 'driver-1',
                trip_id: 'trip-1',
                event_type: 'location_update',
                latitude: 19.076,
                longitude: 72.8777,
            })
        );

        const batchInsert = m.calls.find(
            c => c.table === 'processed_batches' && c.mode === 'insert'
        );

        expect(batchInsert).toBeTruthy();
        expect(batchInsert.payload).toEqual(
            expect.objectContaining({
                idempotency_key: 'batch-1',
                user_id: 'driver-1',
                event_count: 1,
            })
        );
    });

    it('POST /events/batch returns 500 when trip event upsert fails', async () => {
        const originalFrom = m.supabase.from.bind(m.supabase);

        m.supabase.from = table => {
            const builder = originalFrom(table);

            if (table === 'trip_events') {
                builder.upsert = vi.fn(async () => ({
                    data: null,
                    error: { message: 'upsert failed' },
                }));
            }

            return builder;
        };

        const res = await request(buildApp())
            .post('/api/v1/trips/events/batch')
            .set(DRIVER_HEADERS)
            .send(validPayload);

        m.supabase.from = originalFrom;

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Database failed to process batch.');
    });
});