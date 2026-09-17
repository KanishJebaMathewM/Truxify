import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

process.env.BYPASS_AUTH = 'true';
process.env.DEV_ACCESS_TOKEN = 'test-active-trip-token';

let mockStops = [
  {
    id: 'stop-111',
    trip_display_id: 'TX-101',
    customer_name: 'Rahul Logistics',
    route_label: 'Surat → Mumbai',
    goods: 'Textiles',
    drop_location: 'Bhiwandi Hub, Mumbai',
    tonnes: '2.5',
    status_label: 'In Progress',
    sort_order: 1,
    is_current: true,
    is_completed: false,
  },
  {
    id: 'stop-222',
    trip_display_id: 'TX-101',
    customer_name: 'Anand Warehousing',
    route_label: 'Mumbai → Pune',
    goods: 'Industrial Spares',
    drop_location: 'Chakan Industrial Area, Pune',
    tonnes: '1.5',
    status_label: 'Pending',
    sort_order: 2,
    is_current: false,
    is_completed: false,
  }
];

let mockTrip = {
  id: 'trip-999',
  trip_display_id: 'TX-101',
  driver_id: 'driver-active-1',
  order_id: 'ord-active-1',
  route_label: 'Surat → Mumbai → Pune',
  status: 'active',
  trip_date: '2026-08-07',
  total_earnings: 28500,
};

let mockOrder = {
  id: 'ord-active-1',
  delivery_otp: '654321',
  status: 'in_transit',
  escrow_status: 'secured',
};

// Mock database/config module
vi.mock('../../src/config/db.js', () => {
  const mockFrom = (table) => {
    if (table === 'trips') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockTrip, error: null }),
            }),
            maybeSingle: () => Promise.resolve({ data: mockTrip, error: null }),
          }),
          or: () => ({
            maybeSingle: () => Promise.resolve({ data: mockTrip, error: null }),
          }),
        }),
        update: (data) => ({
          eq: () => {
            Object.assign(mockTrip, data);
            return Promise.resolve({ data: mockTrip, error: null });
          }
        })
      };
    }
    if (table === 'trip_stops') {
      return {
        select: () => ({
          eq: (field, val) => {
            const queryRes = {
              data: mockStops,
              error: null,
              eq: (field2, val2) => ({
                maybeSingle: () => {
                  const found = mockStops.find(s => s.id === val && s.trip_display_id === val2);
                  return Promise.resolve({ data: found || null, error: null });
                },
                order: () => ({
                  limit: () => {
                    const uncompleted = mockStops.filter(s => !s.is_completed);
                    return Promise.resolve({ data: uncompleted, error: null });
                  }
                })
              }),
              order: () => Promise.resolve({ data: mockStops, error: null }),
              maybeSingle: () => {
                const found = mockStops.find(s => s.id === val);
                return Promise.resolve({ data: found || null, error: null });
              },
              then: (resolve) => resolve({ data: mockStops, error: null })
            };
            return queryRes;
          }
        }),
        update: (data) => ({
          eq: (field, val) => ({
            select: () => ({
              maybeSingle: () => {
                const target = mockStops.find(s => s.id === val);
                if (target) Object.assign(target, data);
                return Promise.resolve({ data: target || null, error: null });
              }
            }),
            then: (cb) => {
              const target = mockStops.find(s => s.id === val);
              if (target) Object.assign(target, data);
              return Promise.resolve(cb({ data: target, error: null }));
            }
          })
        })
      };
    }
    if (table === 'orders') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: mockOrder, error: null })
          })
        }),
        update: (data) => ({
          eq: () => {
            Object.assign(mockOrder, data);
            return Promise.resolve({ data: mockOrder, error: null });
          }
        })
      };
    }
    return {};
  };

  return {
    supabase: {
      from: mockFrom
    },
    supabaseAdmin: {
      from: mockFrom
    },
    createUserClient: () => ({
      from: mockFrom
    }),
    redisClient: null,
    firebaseAdmin: null
  };
});

import tripRoutes from '../../src/routes/tripRoutes.js';

const devAuthHeaders = {
  'x-dev-access-token': 'test-active-trip-token',
  'x-user-id': 'driver-active-1',
  'x-user-role': 'driver'
};

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/trips', tripRoutes);

describe('Driver Active Trip — Confirm Stop API', () => {
  beforeEach(() => {
    mockStops[0].is_completed = false;
    mockStops[0].status_label = 'In Progress';
    mockStops[1].is_completed = false;
    mockStops[1].status_label = 'Pending';
    mockTrip.status = 'active';
    mockOrder.status = 'in_transit';
    mockOrder.escrow_status = 'secured';
  });

  it('should return 400 when OTP is missing or invalid format', async () => {
    const res = await request(app)
      .post('/api/trips/TX-101/confirm-stop')
      .set(devAuthHeaders)
      .send({ stopId: 'stop-111', otp: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('6-digit OTP');
  });

  it('should return 400 when wrong OTP is provided', async () => {
    const res = await request(app)
      .post('/api/trips/TX-101/confirm-stop')
      .set(devAuthHeaders)
      .send({ stopId: 'stop-111', otp: '999999' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid delivery OTP');
  });

  it('should confirm stop-1 with valid OTP (654321) and advance current stop marker', async () => {
    const res = await request(app)
      .post('/api/trips/TX-101/confirm-stop')
      .set(devAuthHeaders)
      .send({ stopId: 'stop-111', otp: '654321' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.allCompleted).toBe(false);
    expect(res.body.stop.is_completed).toBe(true);
  });

  it('should complete full trip and trigger payment release when final stop is confirmed', async () => {
    mockStops[0].is_completed = true;

    const res = await request(app)
      .post('/api/trips/TX-101/confirm-stop')
      .set(devAuthHeaders)
      .send({ stopId: 'stop-222', otp: '654321' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.allCompleted).toBe(true);
    expect(res.body.paymentReleased).toBe(true);
    expect(mockTrip.status).toBe('completed');
    expect(mockOrder.escrow_status).toBe('payment_released');
  });
});
