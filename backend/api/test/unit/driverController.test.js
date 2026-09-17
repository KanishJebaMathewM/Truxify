import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDriverById, getDriverTrips, updateDriver } from '../../src/controllers/driverController.js';
import { supabaseAdmin } from '../../src/config/db.js';

vi.mock('../../src/config/db.js', () => ({
  supabase: null,
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

describe('driverController', () => {
  let req;
  let res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      params: { driverId: 'd-123' },
      query: {},
      body: {},
      user: { id: 'd-123', role: 'driver' },
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  });

  describe('getDriverById', () => {
    it('returns 404 when driver details are not found', async () => {
      supabaseAdmin.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      await getDriverById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Driver not found.' });
    });

    it('returns 200 with driver details, profile, and truck', async () => {
      const mockDriver = { user_id: 'd-123', rating: 4.8, truck_id: 't-1' };
      const mockProfile = { id: 'd-123', full_name: 'John Doe' };
      const mockTruck = { id: 't-1', truck_type: 'SEMI' };

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'driver_details') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockDriver, error: null }),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
          };
        }
        if (table === 'trucks') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockTruck, error: null }),
          };
        }
        return {};
      });

      await getDriverById(req, res);

      expect(res.json).toHaveBeenCalledWith({
        driver: {
          ...mockDriver,
          profile: mockProfile,
          truck: mockTruck,
        },
      });
    });

    it('returns 500 when database error occurs', async () => {
      supabaseAdmin.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB fail' } }),
      });

      await getDriverById(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch driver details.' });
    });
  });

  describe('getDriverTrips', () => {
    it('returns paginated trip records', async () => {
      req.query = { page: '2', limit: '10' };
      const mockTrips = [{ id: 'trip-1' }, { id: 'trip-2' }];

      supabaseAdmin.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: mockTrips, error: null, count: 25 }),
      });

      await getDriverTrips(req, res);

      expect(res.json).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
        trips: mockTrips,
      });
    });

    it('returns 500 on database error', async () => {
      supabaseAdmin.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB fail' }, count: 0 }),
      });

      await getDriverTrips(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch driver trips.' });
    });
  });

  describe('updateDriver', () => {
    it('returns 403 when user is unauthorized', async () => {
      req.user = { id: 'd-other', role: 'driver' };

      await updateDriver(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden: You cannot update another driver profile.',
      });
    });

    it('allows admin to update another driver profile', async () => {
      req.user = { id: 'admin-1', role: 'admin' };
      req.body = { is_online: true };

      supabaseAdmin.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { user_id: 'd-123', is_online: true },
          error: null,
        }),
      });

      await updateDriver(req, res);

      expect(res.json).toHaveBeenCalledWith({
        message: 'Driver updated successfully.',
        driver: { user_id: 'd-123', is_online: true },
      });
    });

    it('returns 404 when driver is not found', async () => {
      req.body = { is_online: false };

      supabaseAdmin.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      await updateDriver(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Driver profile not found.' });
    });
  });
});
