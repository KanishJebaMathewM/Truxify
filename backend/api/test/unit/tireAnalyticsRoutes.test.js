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

let mockUser = { id: 'usr-mechanic-1', role: 'mechanic' };

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockUser;
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

const tireAnalyticsServiceMock = vi.hoisted(() => ({
  analyzeTireHealth: vi.fn(),
  getTireStatus: vi.fn(),
}));

vi.mock('../../src/services/tireAnalyticsService.js', () => ({
  tireAnalyticsService: tireAnalyticsServiceMock,
}));

const {
  default: tireAnalyticsRouter,
  isValidTruckId,
  isValidTpmsReading,
} = await import('../../src/routes/tireAnalyticsRoutes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tire-analytics', tireAnalyticsRouter);
  return app;
}

describe('tireAnalyticsRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'usr-mechanic-1', role: 'mechanic' };
  });

  describe('Validation Helpers', () => {
    it('validates truck identifier syntax', () => {
      expect(isValidTruckId('TRK-VOLVO-992')).toBe(true);
      expect(isValidTruckId('truck_12:alpha')).toBe(true);
      expect(isValidTruckId('')).toBe(false);
      expect(isValidTruckId('invalid spaced id')).toBe(false);
      expect(isValidTruckId(null)).toBe(false);
    });

    it('validates TPMS sensor readings', () => {
      expect(isValidTpmsReading({ position: 'FL', pressurePsi: 105, tempC: 45, mileageKm: 50000 })).toBe(true);
      expect(isValidTpmsReading({ position: 'FR', pressurePsi: 110, tempC: 50 })).toBe(true);
      expect(isValidTpmsReading({ position: 'RL', pressurePsi: 5, tempC: 50 })).toBe(false); // under 10 PSI
      expect(isValidTpmsReading({ position: 'RR', pressurePsi: 250, tempC: 50 })).toBe(false); // over 200 PSI
      expect(isValidTpmsReading({ position: 'FL', pressurePsi: 100, tempC: 200 })).toBe(false); // over 150 C
      expect(isValidTpmsReading({ position: '', pressurePsi: 100, tempC: 50 })).toBe(false);
      expect(isValidTpmsReading(null)).toBe(false);
    });
  });

  describe('POST /api/tire-analytics/analyze', () => {
    const validPayload = {
      truck_id: 'TRK-VOLVO-992',
      tpms_readings: [
        { position: 'FL', pressurePsi: 105, tempC: 45, mileageKm: 60000 },
        { position: 'FR', pressurePsi: 104, tempC: 46, mileageKm: 60000 },
      ],
    };

    it('generates tire analytics report for authorized mechanic', async () => {
      const mockReport = {
        truckId: validPayload.truck_id,
        overallHealth: 'OPERATIONAL',
        tires: [
          { position: 'FL', alertLevel: 'NORMAL' },
          { position: 'FR', alertLevel: 'NORMAL' },
        ],
      };
      tireAnalyticsServiceMock.analyzeTireHealth.mockResolvedValue(mockReport);

      const res = await request(makeApp())
        .post('/api/tire-analytics/analyze')
        .send(validPayload);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/analytics generated successfully/i);
      expect(res.body.report).toEqual(mockReport);
      expect(tireAnalyticsServiceMock.analyzeTireHealth).toHaveBeenCalledWith({
        ownerId: 'usr-mechanic-1',
        truckId: validPayload.truck_id,
        tpmsReadings: validPayload.tpms_readings,
      });
    });

    it('allows driver and carrier roles to submit TPMS telemetry', async () => {
      mockUser = { id: 'usr-driver-8', role: 'driver' };
      tireAnalyticsServiceMock.analyzeTireHealth.mockResolvedValue({ overallHealth: 'OPERATIONAL' });

      const res = await request(makeApp())
        .post('/api/tire-analytics/analyze')
        .send(validPayload);

      expect(res.status).toBe(200);
    });

    it('denies unauthorized role (e.g. shipper) with 403 Forbidden', async () => {
      mockUser = { id: 'usr-shipper-2', role: 'shipper' };

      const res = await request(makeApp())
        .post('/api/tire-analytics/analyze')
        .send(validPayload);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access Denied/i);
      expect(tireAnalyticsServiceMock.analyzeTireHealth).not.toHaveBeenCalled();
    });

    it('rejects missing parameters with 400', async () => {
      const res = await request(makeApp())
        .post('/api/tire-analytics/analyze')
        .send({ truck_id: 'TRK-1', tpms_readings: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required parameters/i);
    });

    it('rejects invalid truck_id format with 400', async () => {
      const res = await request(makeApp())
        .post('/api/tire-analytics/analyze')
        .send({
          ...validPayload,
          truck_id: 'bad id with spaces',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/alphanumeric identifier/i);
    });

    it('rejects batch exceeding max tire count with 400', async () => {
      const hugeTires = Array.from({ length: 19 }, (_, i) => ({
        position: `T${i}`,
        pressurePsi: 100,
        tempC: 40,
      }));

      const res = await request(makeApp())
        .post('/api/tire-analytics/analyze')
        .send({
          truck_id: 'TRK-1',
          tpms_readings: hugeTires,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Exceeded maximum permissible tire readings/i);
    });

    it('rejects out of bounds pressure reading with 400', async () => {
      const res = await request(makeApp())
        .post('/api/tire-analytics/analyze')
        .send({
          ...validPayload,
          tpms_readings: [{ position: 'FL', pressurePsi: 5, tempC: 40 }], // Under 10 PSI
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid TPMS telemetry at index 0/i);
    });

    it('handles unexpected calculation failure with 500', async () => {
      tireAnalyticsServiceMock.analyzeTireHealth.mockRejectedValue(new Error('Sensor compute error'));

      const res = await request(makeApp())
        .post('/api/tire-analytics/analyze')
        .send(validPayload);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Sensor compute error');
    });
  });

  describe('GET /api/tire-analytics/status/:truckId', () => {
    it('returns tire status report for truck', async () => {
      const mockReport = {
        truckId: 'TRK-VOLVO-992',
        overallHealth: 'OPERATIONAL',
      };
      tireAnalyticsServiceMock.getTireStatus.mockResolvedValue(mockReport);

      const res = await request(makeApp())
        .get('/api/tire-analytics/status/TRK-VOLVO-992');

      expect(res.status).toBe(200);
      expect(res.body.report).toEqual(mockReport);
    });

    it('rejects invalid truckId format with 400', async () => {
      const res = await request(makeApp())
        .get('/api/tire-analytics/status/bad%20spaced%20id');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid truckId format/i);
    });

    it('returns 404 when report not found', async () => {
      tireAnalyticsServiceMock.getTireStatus.mockResolvedValue(null);

      const res = await request(makeApp())
        .get('/api/tire-analytics/status/TRK-UNKNOWN');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/No tire analytics report found/i);
    });
  });

  describe('POST /api/tire-analytics/reset/:truckId', () => {
    it('successfully resets critical tire alert after maintenance', async () => {
      const activeReport = {
        truckId: 'TRK-VOLVO-992',
        overallHealth: 'CRITICAL_ATTENTION_REQUIRED',
      };
      tireAnalyticsServiceMock.getTireStatus.mockResolvedValue(activeReport);

      const res = await request(makeApp())
        .post('/api/tire-analytics/reset/TRK-VOLVO-992');

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/reset successfully after scheduled maintenance/i);
      expect(res.body.report.overallHealth).toBe('OPERATIONAL');
      expect(res.body.report.lastMaintenanceResetAt).toBeDefined();
      expect(res.body.report.maintenanceResetBy).toBe('usr-mechanic-1');
    });

    it('denies unauthorized roles from resetting alerts with 403', async () => {
      mockUser = { id: 'usr-shipper-1', role: 'shipper' };

      const res = await request(makeApp())
        .post('/api/tire-analytics/reset/TRK-VOLVO-992');

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access Denied/i);
    });

    it('returns 404 when attempting to reset non-existent report', async () => {
      tireAnalyticsServiceMock.getTireStatus.mockResolvedValue(null);

      const res = await request(makeApp())
        .post('/api/tire-analytics/reset/TRK-UNKNOWN');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/No tire analytics report found/i);
    });
  });
});
