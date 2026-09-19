import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolvers,
  requireUser,
  canDispatch,
  maskPhone,
  maskTruckNumber,
  sanitizeDriverForCaller,
  mapDriver,
  isWithinRadius,
} from '../../../backend/graphql/services/driver.service.js';
import { supabase } from '../../../backend/api/src/config/db.js';

// Mock dependencies
vi.mock('../../../backend/api/src/config/db.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('../../../backend/api/src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('GraphQL Driver Subgraph Service - PII Protection & Auth Gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Utility: requireUser & canDispatch', () => {
    it('throws Authentication required when user or user.id is missing', () => {
      expect(() => requireUser(null)).toThrow('Authentication required');
      expect(() => requireUser(undefined)).toThrow('Authentication required');
      expect(() => requireUser({})).toThrow('Authentication required');
      expect(() => requireUser({ id: '' })).toThrow('Authentication required');
    });

    it('returns user when user.id is present', () => {
      const user = { id: 'usr-1', role: 'customer' };
      expect(requireUser(user)).toBe(user);
    });

    it('identifies dispatch and admin roles correctly', () => {
      expect(canDispatch({ role: 'ADMIN' })).toBe(true);
      expect(canDispatch({ role: 'admin' })).toBe(true);
      expect(canDispatch({ role: 'DISPATCHER' })).toBe(true);
      expect(canDispatch({ role: 'dispatcher' })).toBe(true);
      expect(canDispatch({ role: 'CUSTOMER' })).toBe(false);
      expect(canDispatch({ role: 'DRIVER' })).toBe(false);
      expect(canDispatch(null)).toBe(false);
      expect(canDispatch(undefined)).toBe(false);
    });
  });

  describe('Utility: maskPhone & maskTruckNumber', () => {
    it('masks phone numbers leaving only last 4 digits visible', () => {
      expect(maskPhone('+919876543210')).toBe('*********3210');
      expect(maskPhone('9876543210')).toBe('******3210');
      expect(maskPhone('12345')).toBe('*2345');
      expect(maskPhone('1234')).toBe('****');
      expect(maskPhone('')).toBe('****');
      expect(maskPhone(null)).toBe('****');
      expect(maskPhone(undefined)).toBe('****');
      expect(maskPhone(1234567890)).toBe('****');
    });

    it('masks truck plate numbers leaving only last 4 characters visible', () => {
      expect(maskTruckNumber('MH12AB1234')).toBe('******1234');
      expect(maskTruckNumber('KA011234')).toBe('****1234');
      expect(maskTruckNumber('ABC')).toBe('****');
      expect(maskTruckNumber('')).toBe('****');
      expect(maskTruckNumber(null)).toBe('****');
      expect(maskTruckNumber(undefined)).toBe('****');
    });
  });

  describe('sanitizeDriverForCaller', () => {
    const sampleDriver = {
      id: 'drv-101',
      user_id: 'usr-driver-1',
      name: 'Rajesh Kumar',
      phone: '+919876543210',
      truck_type: 'FLATBED',
      truck_number: 'MH12AB1234',
      status: 'AVAILABLE',
      current_location: { lat: 18.5204, lng: 73.8567, address: 'Pune' },
      rating: 4.8,
      trips_completed: 45,
    };

    it('returns null/undefined when driver input is null/undefined', () => {
      expect(sanitizeDriverForCaller(null, { id: 'usr-1' })).toBeNull();
      expect(sanitizeDriverForCaller(undefined, { id: 'usr-1' })).toBeUndefined();
    });

    it('masks phone, truckNumber, and hides currentLocation for non-dispatch callers', () => {
      const customerUser = { id: 'usr-customer-99', role: 'CUSTOMER' };
      const sanitized = sanitizeDriverForCaller(sampleDriver, customerUser);

      expect(sanitized.phone).toBe('*********3210');
      expect(sanitized.truckNumber).toBe('******1234');
      expect(sanitized.currentLocation).toBeNull();
      expect(sanitized.name).toBe('Rajesh Kumar');
      expect(sanitized.truckType).toBe('FLATBED');
      expect(sanitized.status).toBe('AVAILABLE');
    });

    it('preserves unmasked PII for dispatcher and admin callers', () => {
      const adminUser = { id: 'usr-admin-1', role: 'ADMIN' };
      const dispatcherUser = { id: 'usr-disp-1', role: 'dispatcher' };

      const adminView = sanitizeDriverForCaller(sampleDriver, adminUser);
      expect(adminView.phone).toBe('+919876543210');
      expect(adminView.truckNumber).toBe('MH12AB1234');
      expect(adminView.currentLocation).toEqual({ lat: 18.5204, lng: 73.8567, address: 'Pune' });

      const dispView = sanitizeDriverForCaller(sampleDriver, dispatcherUser);
      expect(dispView.phone).toBe('+919876543210');
      expect(dispView.truckNumber).toBe('MH12AB1234');
      expect(dispView.currentLocation).toEqual({ lat: 18.5204, lng: 73.8567, address: 'Pune' });
    });

    it('preserves unmasked PII when the driver queries their own record', () => {
      const selfUser = { id: 'usr-driver-1', role: 'DRIVER' };
      const selfView = sanitizeDriverForCaller(sampleDriver, selfUser);

      expect(selfView.phone).toBe('+919876543210');
      expect(selfView.truckNumber).toBe('MH12AB1234');
      expect(selfView.currentLocation).toEqual({ lat: 18.5204, lng: 73.8567, address: 'Pune' });
    });
  });

  describe('Spatial Utility: isWithinRadius', () => {
    const driverInPune = {
      current_location: { lat: 18.5204, lng: 73.8567 },
    };

    it('correctly calculates distance and inclusion within radius', () => {
      const centerNearPune = { lat: 18.5300, lng: 73.8500 }; // ~1.3 km away
      expect(isWithinRadius(driverInPune, centerNearPune, 5)).toBe(true);

      const centerMumbai = { lat: 19.0760, lng: 72.8777 }; // ~120 km away
      expect(isWithinRadius(driverInPune, centerMumbai, 10)).toBe(false);
      expect(isWithinRadius(driverInPune, centerMumbai, 150)).toBe(true);
    });

    it('returns false for invalid center or driver location', () => {
      expect(isWithinRadius(driverInPune, null, 10)).toBe(false);
      expect(isWithinRadius(driverInPune, { lat: NaN, lng: 73.85 }, 10)).toBe(false);
      expect(isWithinRadius({}, { lat: 18.52, lng: 73.85 }, 10)).toBe(false);
    });
  });

  describe('Query Resolvers: Authentication & PII Gating', () => {
    const mockDriverRow = {
      id: 'drv-001',
      user_id: 'usr-drv-001',
      name: 'Aarav Sharma',
      phone: '+919123456789',
      truck_type: 'CONTAINER',
      truck_number: 'DL01XY9876',
      status: 'AVAILABLE',
      current_location: { lat: 28.6139, lng: 77.2090 },
      rating: 4.9,
      trips_completed: 100,
    };

    describe('Query.driver(id)', () => {
      it('throws Authentication required if context has no authenticated user', async () => {
        await expect(resolvers.Query.driver(null, { id: 'drv-001' }, {})).rejects.toThrow(
          'Authentication required'
        );
      });

      it('returns masked driver details for non-dispatch caller', async () => {
        supabase.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockDriverRow, error: null }),
            }),
          }),
        });

        const context = { user: { id: 'cust-1', role: 'CUSTOMER' } };
        const result = await resolvers.Query.driver(null, { id: 'drv-001' }, context);

        expect(result.id).toBe('drv-001');
        expect(result.name).toBe('Aarav Sharma');
        expect(result.phone).toBe('*********6789');
        expect(result.truckNumber).toBe('******9876');
        expect(result.currentLocation).toBeNull();
      });

      it('returns unmasked driver details for admin / dispatcher', async () => {
        supabase.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockDriverRow, error: null }),
            }),
          }),
        });

        const context = { user: { id: 'admin-1', role: 'ADMIN' } };
        const result = await resolvers.Query.driver(null, { id: 'drv-001' }, context);

        expect(result.phone).toBe('+919123456789');
        expect(result.truckNumber).toBe('DL01XY9876');
        expect(result.currentLocation).toEqual({ lat: 28.6139, lng: 77.2090 });
      });
    });

    describe('Query.drivers(available, location)', () => {
      it('throws Authentication required when user is unauthenticated', async () => {
        await expect(resolvers.Query.drivers(null, {}, {})).rejects.toThrow(
          'Authentication required'
        );
      });

      it('filters and masks driver list for non-dispatch callers', async () => {
        const driversList = [
          mockDriverRow,
          {
            ...mockDriverRow,
            id: 'drv-002',
            user_id: 'usr-drv-002',
            phone: '+919988776655',
            truck_number: 'HR26AB5544',
            current_location: { lat: 28.4595, lng: 77.0266 }, // Gurgaon (~30km away)
          },
        ];

        supabase.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue(Promise.resolve({ data: driversList, error: null })),
          }),
        });

        const context = { user: { id: 'cust-1', role: 'CUSTOMER' } };
        const results = await resolvers.Query.drivers(null, { available: true }, context);

        expect(results).toHaveLength(2);
        expect(results[0].phone).toBe('*********6789');
        expect(results[0].currentLocation).toBeNull();
        expect(results[1].phone).toBe('*********6655');
        expect(results[1].currentLocation).toBeNull();
      });
    });

    describe('Query.nearbyDrivers(lat, lng, radius)', () => {
      it('throws Authentication required when user is unauthenticated', async () => {
        await expect(
          resolvers.Query.nearbyDrivers(null, { lat: 28.6139, lng: 77.2090 }, {})
        ).rejects.toThrow('Authentication required');
      });

      it('filters drivers within geographic radius and masks PII for customer callers', async () => {
        const driversList = [
          mockDriverRow, // Delhi (lat: 28.6139, lng: 77.2090)
          {
            ...mockDriverRow,
            id: 'drv-far',
            user_id: 'usr-drv-far',
            phone: '+919999999999',
            truck_number: 'MH12XX0000',
            current_location: { lat: 18.5204, lng: 73.8567 }, // Pune (>1000km away)
          },
        ];

        supabase.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue(Promise.resolve({ data: driversList, error: null })),
          }),
        });

        const context = { user: { id: 'cust-1', role: 'CUSTOMER' } };
        const results = await resolvers.Query.nearbyDrivers(
          null,
          { lat: 28.6139, lng: 77.2090, radius: 20 },
          context
        );

        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('drv-001');
        expect(results[0].phone).toBe('*********6789');
        expect(results[0].truckNumber).toBe('******9876');
        expect(results[0].currentLocation).toBeNull();
      });
    });
  });
});
