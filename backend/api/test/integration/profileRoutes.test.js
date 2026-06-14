import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../src/lib/profileCache.js', () => ({
  invalidateCachedProfile: vi.fn(),
  getCachedProfile: vi.fn(),
  setCachedProfile: vi.fn(),
}));

const { invalidateCachedProfile } = await import('../../src/lib/profileCache.js');

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

const { default: profileRouter } = await import('../../src/routes/profileRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/profile', profileRouter);
  return app;
}

const CUSTOMER_HEADERS = {
  'x-user-id': 'customer-uuid-123',
  'x-user-role': 'customer',
  'x-user-name': 'Test Customer',
};

const DRIVER_HEADERS = {
  'x-user-id': 'driver-uuid-456',
  'x-user-role': 'driver',
  'x-user-name': 'Test Driver',
};

describe('Profile Routes', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    m.store.profiles = [];
    m.store.customer_stats = [];
    m.store.driver_details = [];
    m.calls.length = 0;
    vi.clearAllMocks();
  });

  describe('GET /api/profile', () => {
    it('returns 404 if profile not found', async () => {
      const res = await request(buildApp())
        .get('/api/profile')
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Profile not found');
    });

    it('returns customer profile and statistics for customer role', async () => {
      // Seed data
      m.store.profiles.push({
        id: 'customer-uuid-123',
        firebase_uid: 'firebase-cust-uid',
        role: 'customer',
        full_name: 'Jane Doe',
        phone: '+919876543210',
        email: 'jane@example.com',
        company_name: 'Acme Corp',
        avatar_url: 'https://r2.com/avatar.jpg',
        language: 'en',
        dark_mode: false,
        is_active: true,
      });

      m.store.customer_stats.push({
        id: 'stats-1',
        user_id: 'customer-uuid-123',
        total_orders: 42,
        total_saved: 12500, // paisa
        co2_reduced_kg: 15.6,
      });

      const res = await request(buildApp())
        .get('/api/profile')
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.profile).toEqual({
        id: 'customer-uuid-123',
        firebaseUid: 'firebase-cust-uid',
        role: 'customer',
        fullName: 'Jane Doe',
        phone: '+919876543210',
        email: 'jane@example.com',
        companyName: 'Acme Corp',
        avatarUrl: 'https://r2.com/avatar.jpg',
        language: 'en',
        darkMode: false,
        isActive: true,
      });

      expect(res.body.extra).toEqual({
        totalOrders: 42,
        totalSaved: 12500,
        co2ReducedKg: 15.6,
      });
    });

    it('returns driver profile and details for driver role', async () => {
      // Seed data
      m.store.profiles.push({
        id: 'driver-uuid-456',
        firebase_uid: 'firebase-driver-uid',
        role: 'driver',
        full_name: 'John Driver',
        phone: '+919999999999',
        email: 'john@example.com',
        company_name: null,
        avatar_url: 'https://r2.com/driver.jpg',
        language: 'hi',
        dark_mode: true,
        is_active: true,
      });

      m.store.driver_details.push({
        id: 'details-1',
        user_id: 'driver-uuid-456',
        truck_id: 'truck-123',
        rating: 4.85,
        total_trips: 150,
        completion_rate: 98.5,
        is_online: true,
        wallet_confirmed: 50000,
        wallet_pending: 12000,
        wallet_total: 62000,
      });

      const res = await request(buildApp())
        .get('/api/profile')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.profile).toEqual({
        id: 'driver-uuid-456',
        firebaseUid: 'firebase-driver-uid',
        role: 'driver',
        fullName: 'John Driver',
        phone: '+919999999999',
        email: 'john@example.com',
        companyName: null,
        avatarUrl: 'https://r2.com/driver.jpg',
        language: 'hi',
        darkMode: true,
        isActive: true,
      });

      expect(res.body.extra).toEqual({
        truckId: 'truck-123',
        rating: 4.85,
        totalTrips: 150,
        completionRate: 98.5,
        isOnline: true,
        walletConfirmed: 50000,
        walletPending: 12000,
        walletTotal: 62000,
      });
    });
  });

  describe('PUT /api/profile', () => {
    it('updates profiles fields for customer role', async () => {
      // Seed profile
      m.store.profiles.push({
        id: 'customer-uuid-123',
        firebase_uid: 'firebase-cust-uid',
        role: 'customer',
        full_name: 'Old Name',
        phone: '+919876543210',
        email: 'jane@example.com',
        company_name: 'Acme Corp',
        avatar_url: 'https://r2.com/avatar.jpg',
        language: 'en',
        dark_mode: false,
        is_active: true,
      });

      // Mock update response (Supabase single() on update)
      const updatedProfileRow = {
        id: 'customer-uuid-123',
        full_name: 'New Name',
        language: 'hi',
        dark_mode: true,
      };
      m.programData(updatedProfileRow);

      const res = await request(buildApp())
        .put('/api/profile')
        .set(CUSTOMER_HEADERS)
        .send({
          full_name: 'New Name',
          language: 'hi',
          dark_mode: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Profile updated');
      expect(res.body.profile).toEqual(updatedProfileRow);
      expect(invalidateCachedProfile).toHaveBeenCalledWith('test_firebase_uid_123');

      const profileUpdateCall = m.calls.find(c => c.table === 'profiles' && c.mode === 'update');
      expect(profileUpdateCall.payload).toEqual({
        full_name: 'New Name',
        language: 'hi',
        dark_mode: true,
      });
    });

    it('updates profiles fields and driver online status for driver role', async () => {
      // Seed profile and driver details
      m.store.profiles.push({
        id: 'driver-uuid-456',
        firebase_uid: 'firebase-driver-uid',
        role: 'driver',
        full_name: 'Old Driver Name',
        phone: '+919999999999',
        email: 'john@example.com',
        company_name: null,
        avatar_url: 'https://r2.com/driver.jpg',
        language: 'en',
        dark_mode: false,
        is_active: true,
      });

      m.store.driver_details.push({
        id: 'details-1',
        user_id: 'driver-uuid-456',
        truck_id: 'truck-123',
        rating: 4.85,
        total_trips: 150,
        completion_rate: 98.5,
        is_online: false,
        wallet_confirmed: 50000,
        wallet_pending: 12000,
        wallet_total: 62000,
      });

      const updatedProfileRow = {
        id: 'driver-uuid-456',
        full_name: 'New Driver Name',
        language: 'hi',
        dark_mode: true,
      };
      m.programData(updatedProfileRow);

      const res = await request(buildApp())
        .put('/api/profile')
        .set(DRIVER_HEADERS)
        .send({
          full_name: 'New Driver Name',
          language: 'hi',
          dark_mode: true,
          is_online: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Profile updated');
      expect(res.body.profile).toEqual(updatedProfileRow);
      expect(invalidateCachedProfile).toHaveBeenCalledWith('test_firebase_uid_123');

      const profileUpdateCall = m.calls.find(c => c.table === 'profiles' && c.mode === 'update');
      expect(profileUpdateCall.payload).toEqual({
        full_name: 'New Driver Name',
        language: 'hi',
        dark_mode: true,
      });

      const driverUpdateCall = m.calls.find(c => c.table === 'driver_details' && c.mode === 'update');
      expect(driverUpdateCall.payload).toEqual({
        is_online: true,
      });
      expect(driverUpdateCall.filters).toContainEqual({ col: 'user_id', op: 'eq', val: 'driver-uuid-456' });
    });
  });
});
