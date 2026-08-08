import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

process.env.BYPASS_AUTH = 'true';
process.env.DEV_ACCESS_TOKEN = 'test-voice-token';

// Mock database/config module
vi.mock('../../src/config/db.js', () => {
  const mockOrder = {
    id: 'ord-123',
    order_display_id: 'ORD-12345',
    status: 'in_transit',
    current_location_name: 'NH-48 Jaipur Highway',
    eta: '35 minutes',
    escrow_status: 'secured in smart contract escrow',
    customer_id: 'user-voice-1'
  };

  const mockFrom = (table) => {
    if (table === 'orders') {
      return {
        select: () => ({
          eq: () => ({
            or: () => ({
              maybeSingle: () => Promise.resolve({ data: mockOrder, error: null })
            }),
            maybeSingle: () => Promise.resolve({ data: mockOrder, error: null })
          }),
          or: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: mockOrder, error: null })
              })
            }),
            maybeSingle: () => Promise.resolve({ data: mockOrder, error: null })
          })
        })
      };
    }
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { id: 'user-voice-1', role: 'customer', is_active: true },
                error: null
              })
            })
          })
        })
      };
    }
    return {};
  };

  return {
    supabase: {
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'user-voice-1' } }, error: null })
      },
      from: mockFrom
    },
    createUserClient: () => ({
      from: mockFrom
    }),
    redisClient: null,
    firebaseAdmin: null
  };
});

import voiceRoutes from '../../src/routes/voiceRoutes.js';

const devAuthHeaders = {
  'x-dev-access-token': 'test-voice-token',
  'x-user-id': 'user-voice-1',
  'x-user-role': 'customer'
};

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/voice', voiceRoutes);

describe('Voice AI Query API Endpoints', () => {
  it('should process location query ("Where is my package?") correctly', async () => {
    const res = await request(app)
      .post('/api/voice/query')
      .set(devAuthHeaders)
      .send({ query: 'Where is my package?', bookingId: 'ORD-12345' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('transcript');
    expect(res.body.intent).toBe('location');
    expect(res.body.response_text).toContain('in transit');
    expect(res.body).toHaveProperty('audio_url');
  });

  it('should process ETA query ("When will it arrive?") correctly', async () => {
    const res = await request(app)
      .post('/api/voice/query')
      .set(devAuthHeaders)
      .send({ query: 'When will it arrive?', bookingId: 'ORD-12345' });

    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('eta');
    expect(res.body.response_text).toContain('estimated');
  });

  it('should process payment/escrow query ("Is my payment released?") correctly', async () => {
    const res = await request(app)
      .post('/api/voice/query')
      .set(devAuthHeaders)
      .send({ query: 'Is my payment released?', bookingId: 'ORD-12345' });

    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('escrow');
    expect(res.body.response_text).toContain('escrow');
  });

  it('should fetch generated audio by ID', async () => {
    const queryRes = await request(app)
      .post('/api/voice/query')
      .set(devAuthHeaders)
      .send({ query: 'Where is my package?' });

    expect(queryRes.status).toBe(200);
    const audioUrl = queryRes.body.audio_url;
    const audioId = audioUrl.split('/api/voice/audio/')[1];

    const audioRes = await request(app)
      .get(`/api/voice/audio/${audioId}`)
      .set(devAuthHeaders);

    expect(audioRes.status).toBe(200);
    expect(audioRes.header['content-type']).toContain('audio/mpeg');
  });

  it('should return 400 when neither file nor query text is provided', async () => {
    const res = await request(app)
      .post('/api/voice/query')
      .set(devAuthHeaders)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
