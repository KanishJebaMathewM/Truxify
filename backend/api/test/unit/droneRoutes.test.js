import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

let mockUser = { id: 'usr-driver-99', role: 'driver' };

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockUser;
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

const droneServiceMock = vi.hoisted(() => ({
  launchDroneDelivery: vi.fn(),
  getDroneTelemetry: vi.fn(),
}));

vi.mock('../../src/services/droneService.js', () => ({
  droneService: droneServiceMock,
}));

const {
  default: droneRouter,
  isValidGpsCoordinate,
  calculateFlightDistanceKm,
  isValidMissionId,
} = await import('../../src/routes/droneRoutes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/drone', droneRouter);
  return app;
}

describe('droneRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'usr-driver-99', role: 'driver' };
  });

  describe('Validation & Flight Geocalc Helpers', () => {
    it('validates GPS coordinates correctly', () => {
      expect(isValidGpsCoordinate({ lat: 28.6139, lng: 77.2090 })).toBe(true);
      expect(isValidGpsCoordinate({ lat: -90, lng: 180 })).toBe(true);
      expect(isValidGpsCoordinate({ lat: 91, lng: 0 })).toBe(false);
      expect(isValidGpsCoordinate({ lat: 0, lng: -181 })).toBe(false);
      expect(isValidGpsCoordinate({ lat: '28.6', lng: 77.2 })).toBe(false);
      expect(isValidGpsCoordinate(null)).toBe(false);
      expect(isValidGpsCoordinate({})).toBe(false);
    });

    it('calculates Haversine flight distance accurately', () => {
      // New Delhi (28.6139, 77.2090) to nearby point ~5km away
      const start = { lat: 28.6139, lng: 77.2090 };
      const dest = { lat: 28.6500, lng: 77.2300 };
      const dist = calculateFlightDistanceKm(start, dest);
      expect(dist).toBeGreaterThan(4);
      expect(dist).toBeLessThan(6);
    });

    it('validates mission ID format', () => {
      expect(isValidMissionId('MSN-a1b2c3d4e5f60718')).toBe(true);
      expect(isValidMissionId('MSN-12345678-uuid')).toBe(true);
      expect(isValidMissionId('INVALID-ID')).toBe(false);
      expect(isValidMissionId('MSN-')).toBe(false);
      expect(isValidMissionId(null)).toBe(false);
    });
  });

  describe('POST /api/drone/launch', () => {
    const validLaunchPayload = {
      trip_id: 'TRP-101',
      parcel_id: 'PCL-9988',
      safe_zone_gps: { lat: 28.6139, lng: 77.2090 },
      destination_gps: { lat: 28.6300, lng: 77.2200 }, // ~2 km flight
    };

    it('successfully dispatches drone mission when requested by authorized driver', async () => {
      const mockMission = {
        missionId: 'MSN-a1b2c3d4e5f60718',
        droneId: 'DRN-AeroX-42',
        status: 'DISPATCHED',
      };
      droneServiceMock.launchDroneDelivery.mockResolvedValue(mockMission);

      const res = await request(makeApp())
        .post('/api/drone/launch')
        .send(validLaunchPayload);

      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/launched successfully/i);
      expect(res.body.mission).toEqual(mockMission);
      expect(res.body.flightDistanceKm).toBeDefined();
      expect(droneServiceMock.launchDroneDelivery).toHaveBeenCalledWith({
        ownerId: 'usr-driver-99',
        tripId: 'TRP-101',
        parcelId: 'PCL-9988',
        safeZoneGps: validLaunchPayload.safe_zone_gps,
        destinationGps: validLaunchPayload.destination_gps,
      });
    });

    it('allows dispatcher and admin roles to launch drones', async () => {
      mockUser = { id: 'usr-dispatch-1', role: 'dispatcher' };
      droneServiceMock.launchDroneDelivery.mockResolvedValue({ missionId: 'MSN-1' });

      const res = await request(makeApp())
        .post('/api/drone/launch')
        .send(validLaunchPayload);

      expect(res.status).toBe(201);
    });

    it('rejects launch request from unauthorized roles (e.g. shipper) with 403 Forbidden', async () => {
      mockUser = { id: 'usr-shipper-5', role: 'shipper' };

      const res = await request(makeApp())
        .post('/api/drone/launch')
        .send(validLaunchPayload);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access Denied/i);
      expect(droneServiceMock.launchDroneDelivery).not.toHaveBeenCalled();
    });

    it('rejects request with missing parameters with 400', async () => {
      const res = await request(makeApp())
        .post('/api/drone/launch')
        .send({ trip_id: 'TRP-1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required parameters/i);
    });

    it('rejects invalid GPS coordinates with 400', async () => {
      const res = await request(makeApp())
        .post('/api/drone/launch')
        .send({
          ...validLaunchPayload,
          safe_zone_gps: { lat: 95, lng: 77 }, // lat > 90
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/safe_zone_gps must contain valid latitude/i);
    });

    it('rejects missions exceeding maximum flight radius limit with 400', async () => {
      const res = await request(makeApp())
        .post('/api/drone/launch')
        .send({
          ...validLaunchPayload,
          destination_gps: { lat: 29.5, lng: 78.5 }, // ~160 km away!
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/exceeds maximum permissible drone flight radius/i);
      expect(res.body.maxRadiusKm).toBe(25);
    });

    it('handles unexpected launch failure with 500', async () => {
      droneServiceMock.launchDroneDelivery.mockRejectedValue(new Error('Hardware comms failure'));

      const res = await request(makeApp())
        .post('/api/drone/launch')
        .send(validLaunchPayload);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Hardware comms failure');
    });
  });

  describe('GET /api/drone/telemetry/:missionId', () => {
    it('returns telemetry for active mission', async () => {
      const mockTelemetry = {
        missionId: 'MSN-a1b2c3d4e5f60718',
        droneId: 'DRN-AeroX-42',
        status: 'IN_FLIGHT',
        batteryPercent: 88,
      };
      droneServiceMock.getDroneTelemetry.mockResolvedValue(mockTelemetry);

      const res = await request(makeApp())
        .get('/api/drone/telemetry/MSN-a1b2c3d4e5f60718');

      expect(res.status).toBe(200);
      expect(res.body.telemetry).toEqual(mockTelemetry);
      expect(droneServiceMock.getDroneTelemetry).toHaveBeenCalledWith(
        'MSN-a1b2c3d4e5f60718',
        'usr-driver-99'
      );
    });

    it('rejects invalid missionId format with 400', async () => {
      const res = await request(makeApp())
        .get('/api/drone/telemetry/bad-id');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid missionId format/i);
    });

    it('returns 404 when mission is not found', async () => {
      droneServiceMock.getDroneTelemetry.mockResolvedValue(null);

      const res = await request(makeApp())
        .get('/api/drone/telemetry/MSN-9999999999999999');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('POST /api/drone/abort/:missionId', () => {
    it('successfully aborts active mission and returns to base', async () => {
      const activeMission = {
        missionId: 'MSN-a1b2c3d4e5f60718',
        droneId: 'DRN-AeroX-42',
        status: 'DISPATCHED',
      };
      droneServiceMock.getDroneTelemetry.mockResolvedValue(activeMission);

      const res = await request(makeApp())
        .post('/api/drone/abort/MSN-a1b2c3d4e5f60718');

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/returning to safe zone base/i);
      expect(res.body.mission.status).toBe('ABORTED_RETURNING_TO_BASE');
      expect(res.body.mission.abortedAt).toBeDefined();
    });

    it('returns 404 when attempting to abort nonexistent mission', async () => {
      droneServiceMock.getDroneTelemetry.mockResolvedValue(null);

      const res = await request(makeApp())
        .post('/api/drone/abort/MSN-0000000000000000');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });
});
