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

    it('POST /events/batch returns 422 for otpDelivery event containing otp', async () => {
        const res = await request(buildApp())
            .post('/api/v1/trips/events/batch')
            .set(DRIVER_HEADERS)
            .send({
                idempotencyKey: 'batch-otp-leak',
                events: [
                    {
                        id: 'event-otp-leak',
                        trip_id: 'trip-1',
                        type: 'otpDelivery',
                        occurred_at: new Date().toISOString(),
                        payload: {
                            stopId: 'stop-1',
                            otp: '123456',
                        },
                    },
                ],
            });

        expect(res.status).toBe(422);
        expect(res.body.error).toContain('Unprocessable Entity: Invalid event payload for type otpDelivery');
    });

    it('POST /events/batch returns 422 for gpsUpdate event with out of bounds coordinates', async () => {
        const res = await request(buildApp())
            .post('/api/v1/trips/events/batch')
            .set(DRIVER_HEADERS)
            .send({
                idempotencyKey: 'batch-gps-oob',
                events: [
                    {
                        id: 'event-gps-oob',
                        trip_id: 'trip-1',
                        type: 'gpsUpdate',
                        occurred_at: new Date().toISOString(),
                        payload: {
                            lat: 95.0,
                            lng: 72.8777,
                        },
                    },
                ],
            });

        expect(res.status).toBe(422);
        expect(res.body.error).toContain('Unprocessable Entity: Invalid event payload for type gpsUpdate');
    });

    it('POST /events/batch inserts trip events and strips sensitive fields from metadata', async () => {
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
                    return { data: payload, error: null };
                });
            }
            return builder;
        };

        const res = await request(buildApp())
            .post('/api/v1/trips/events/batch')
            .set(DRIVER_HEADERS)
            .send({
                idempotencyKey: 'batch-sensitive-strip',
                events: [
                    {
                        id: 'event-sensitive',
                        trip_id: 'trip-1',
                        type: 'gpsUpdate',
                        occurred_at: new Date().toISOString(),
                        payload: {
                            lat: 19.076,
                            lng: 72.8777,
                            secret: 'my-sensitive-token',
                            password: 'my-password',
                        },
                    },
                ],
            });

        m.supabase.from = originalFrom;

        expect(res.status).toBe(202);
        const upsertCall = m.calls.find(
            c => c.table === 'trip_events' && c.mode === 'upsert' && c.payload[0].event_id === 'event-sensitive'
        );
        expect(upsertCall).toBeTruthy();
        expect(upsertCall.payload[0].metadata).not.toHaveProperty('secret');
        expect(upsertCall.payload[0].metadata).not.toHaveProperty('password');
        expect(upsertCall.payload[0].metadata.lat).toBe(19.076);
    });
});

// ============================================================================
// GET /api/trips/:id/events - Trip Events Retrieval
// ============================================================================

const CUSTOMER_HEADERS = {
  'x-user-id': 'customer-1',
  'x-user-role': 'customer',
};

const ADMIN_HEADERS = {
  'x-user-id': 'admin-1',
  'x-user-role': 'admin',
};

function buildEventsApp() {
  const app = express();
  app.use(express.json());
  // Mount on /api/trips so /:id/events resolves correctly
  app.use('/api/trips', tripRouter);
  return app;
}

describe('GET /api/trips/:id/events', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    m.store.trip_events = [];
    m.store.orders = [];
    m.calls.length = 0;
  });

  it('returns 404 when trip has no events and no matching order', async () => {
    const res = await request(buildEventsApp())
      .get('/api/trips/nonexistent-trip/events')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Trip not found.');
  });

  it('returns events for the driver who uploaded them', async () => {
    m.store.trip_events.push(
      { event_id: 'ev-1', user_id: 'driver-1', trip_id: 'trip-abc', event_type: 'gpsUpdate', event_timestamp: '2026-06-01T10:00:00Z', latitude: 19.0, longitude: 72.8, metadata: {}, created_at: '2026-06-01T10:00:00Z' },
      { event_id: 'ev-2', user_id: 'driver-1', trip_id: 'trip-abc', event_type: 'milestone', event_timestamp: '2026-06-01T11:00:00Z', latitude: null, longitude: null, metadata: { milestone: 'Delivered' }, created_at: '2026-06-01T11:00:00Z' },
    );

    const res = await request(buildEventsApp())
      .get('/api/trips/trip-abc/events')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.trip_id).toBe('trip-abc');
    expect(res.body.events).toHaveLength(2);
  });

  it('returns 403 for a user who is neither driver, customer, nor admin', async () => {
    m.store.trip_events.push(
      { event_id: 'ev-1', user_id: 'driver-1', trip_id: 'trip-abc', event_type: 'gpsUpdate', event_timestamp: '2026-06-01T10:00:00Z', latitude: 19.0, longitude: 72.8, metadata: {}, created_at: '2026-06-01T10:00:00Z' },
    );
    // No order => customer_id won't match
    const res = await request(buildEventsApp())
      .get('/api/trips/trip-abc/events')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(403);
  });

  it('allows the order customer to access trip events', async () => {
    m.store.trip_events.push(
      { event_id: 'ev-1', user_id: 'driver-1', trip_id: 'trip-xyz', event_type: 'gpsUpdate', event_timestamp: '2026-06-01T10:00:00Z', latitude: 19.0, longitude: 72.8, metadata: {}, created_at: '2026-06-01T10:00:00Z' },
    );
    m.store.orders.push({ id: 'trip-xyz', driver_id: 'driver-1', customer_id: 'customer-1' });

    const res = await request(buildEventsApp())
      .get('/api/trips/trip-xyz/events')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
  });

  it('allows admins to access any trip events', async () => {
    m.store.trip_events.push(
      { event_id: 'ev-1', user_id: 'driver-1', trip_id: 'trip-admin', event_type: 'gpsUpdate', event_timestamp: '2026-06-01T10:00:00Z', latitude: 19.0, longitude: 72.8, metadata: {}, created_at: '2026-06-01T10:00:00Z' },
    );

    const res = await request(buildEventsApp())
      .get('/api/trips/trip-admin/events')
      .set(ADMIN_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
  });

  it('filters events by type when ?type query param is provided', async () => {
    m.store.trip_events.push(
      { event_id: 'ev-1', user_id: 'driver-1', trip_id: 'trip-filter', event_type: 'gpsUpdate', event_timestamp: '2026-06-01T10:00:00Z', latitude: 19.0, longitude: 72.8, metadata: {}, created_at: '2026-06-01T10:00:00Z' },
      { event_id: 'ev-2', user_id: 'driver-1', trip_id: 'trip-filter', event_type: 'milestone', event_timestamp: '2026-06-01T11:00:00Z', latitude: null, longitude: null, metadata: {}, created_at: '2026-06-01T11:00:00Z' },
    );

    const res = await request(buildEventsApp())
      .get('/api/trips/trip-filter/events?type=gpsUpdate')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].event_type).toBe('gpsUpdate');
  });
});