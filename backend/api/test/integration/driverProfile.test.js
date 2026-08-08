import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

let mockGetUser = vi.fn();
let mockProfile = null;
let mockDriverDetails = null;
let mockTruck = null;
let mockDocs = [];
let mockUpdateDetails = vi.fn();
let mockUpdateTruck = vi.fn();
let mockInsertTruck = vi.fn();

vi.mock('../../src/config/db.js', () => {
  const fromMock = (table) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockProfile, error: null })
            }),
            maybeSingle: () => Promise.resolve({ data: mockProfile, error: null })
          })
        })
      };
    }
    if (table === 'driver_details') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: mockDriverDetails, error: null })
          })
        }),
        update: (...args) => {
          mockUpdateDetails(...args);
          return {
            eq: () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve({ data: { ...mockDriverDetails, is_online: args[0].is_online }, error: null })
              })
            })
          };
        }
      };
    }
    if (table === 'trucks') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: mockTruck, error: null })
          })
        }),
        update: (...args) => {
          mockUpdateTruck(...args);
          return {
            eq: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: { ...mockTruck, ...args[0] }, error: null })
              })
            })
          };
        },
        insert: (...args) => {
          mockInsertTruck(...args);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'new-truck-id', ...args[0] }, error: null })
            })
          };
        }
      };
    }
    if (table === 'driver_documents') {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: mockDocs, error: null })
        })
      };
    }
    return {};
  };

  return {
    supabase: {
      auth: {
        getUser: (...args) => mockGetUser(...args)
      },
      from: fromMock
    },
    createUserClient: () => ({
      from: fromMock
    }),
    redisClient: null,
    firebaseAdmin: null
  };
});

const { default: driverRouter } = await import('../../src/routes/driverRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/driver', driverRouter);
  app.use((err, req, res, next) => {
    console.error('EXPRESS ERROR:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  });
  return app;
}

describe('Driver Profile & Availability Endpoints', () => {
  let app;
  let token;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    mockUpdateDetails.mockReset();
    mockUpdateTruck.mockReset();
    mockInsertTruck.mockReset();

    process.env.BYPASS_AUTH = 'false';
    mockGetUser.mockResolvedValue({ data: { user: { id: 'driver-123' } }, error: null });
    token = jwt.sign({ iss: 'https://xyz.supabase.co' }, 'secret');

    // Default test data
    mockProfile = {
      id: 'driver-123',
      full_name: 'John Driver',
      phone: '+919999999999',
      email: 'john.driver@truxify.com'
    };
    mockDriverDetails = {
      rating: 4.7,
      total_trips: 25,
      completion_rate: 96,
      is_online: true,
      kyc_status: 'Verified',
      truck_id: 'truck-123'
    };
    mockTruck = {
      id: 'truck-123',
      truck_type: 'Medium Duty',
      capacity_weight_tonnes: 8.5,
      capacity_volume_m3: 24.0,
      registration_number: 'MH12AB5678'
    };
    mockDocs = [
      { document_type: 'rc_book', status: 'approved', is_govt_verified: true },
      { document_type: 'driving_licence', status: 'approved', is_govt_verified: false },
      { document_type: 'insurance', status: 'pending_review', is_govt_verified: false }
    ];
  });

  describe('GET /api/driver/profile', () => {
    it('returns consolidated driver profile, details, truck, and documents', async () => {
      const res = await request(app)
        .get('/api/driver/profile')
        .set('Authorization', `Bearer ${token}`);

      console.log('STATUS:', res.status, 'BODY:', res.body);
      expect(res.status).toBe(200);
      expect(res.body.profile.full_name).toBe('John Driver');
      expect(res.body.driverDetails.rating).toBe(4.7);
      expect(res.body.truck.truck_type).toBe('Medium Duty');
      
      // Verify documents mapping
      expect(res.body.documents.rc_book).toBe('Verified (Digilocker)');
      expect(res.body.documents.driving_licence).toBe('Uploaded');
      expect(res.body.documents.insurance).toBe('Uploaded');
    });

    it('returns Missing status for empty documents', async () => {
      mockDocs = [];
      const res = await request(app)
        .get('/api/driver/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.documents.rc_book).toBe('Missing');
      expect(res.body.documents.driving_licence).toBe('Missing');
      expect(res.body.documents.insurance).toBe('Missing');
    });
  });

  describe('PATCH /api/driver/availability', () => {
    it('successfully updates driver online/offline availability status', async () => {
      const res = await request(app)
        .patch('/api/driver/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({ available: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.isOnline).toBe(false);
      expect(mockUpdateDetails).toHaveBeenCalledWith({
        is_online: false,
        updated_at: expect.any(String)
      });
    });

    it('returns 400 if available field is missing or not a boolean', async () => {
      const res = await request(app)
        .patch('/api/driver/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({ available: 'yes' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must be a boolean');
    });
  });

  describe('PUT /api/driver/truck', () => {
    it('updates truck details if truck_id is assigned', async () => {
      const res = await request(app)
        .put('/api/driver/truck')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'Heavy Duty Truck',
          capacityWeight: 16.0,
          capacityVolume: 50.0,
          registrationNumber: 'MH12AB9999'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.truck.truck_type).toBe('Heavy Duty Truck');
      expect(res.body.truck.capacity_weight_tonnes).toBe(16.0);
      expect(res.body.truck.registration_number).toBe('MH12AB9999');
      expect(mockUpdateTruck).toHaveBeenCalled();
    });

    it('inserts a new truck and links to driver if no truck_id is assigned', async () => {
      mockDriverDetails.truck_id = null;
      const res = await request(app)
        .put('/api/driver/truck')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'Heavy Duty Truck',
          capacityWeight: 16.0,
          capacityVolume: 50.0,
          registrationNumber: 'MH12AB9999'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockInsertTruck).toHaveBeenCalledWith(
        expect.objectContaining({ driver_id: 'driver-123' })
      );
      expect(mockUpdateDetails).toHaveBeenCalled();
    });
  });
});
