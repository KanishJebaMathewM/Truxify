import { describe, it, expect, vi } from 'vitest';
import { tripValidator } from '../../src/middleware/tripValidator.js';

describe('tripValidator Middleware', () => {
  it('allows valid trip ID in params', () => {
    const req = { params: { id: 'trip-123' } };
    const res = {};
    const next = vi.fn();

    tripValidator.validate(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects a malformed trip ID', () => {
    const req = { params: { id: 'trip id with spaces!' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    tripValidator.validate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid trip ID' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a missing trip ID', () => {
    const req = { params: {} };
    const res = {};
    const next = vi.fn();

    tripValidator.validate(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects a negative odometer reading', () => {
    const req = { params: {}, body: { odometer_km: -1 } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    tripValidator.validate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid odometer reading' }));
  });

  it('rejects a non-numeric odometer reading', () => {
    const req = { params: {}, body: { odometer_km: 'abc' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    tripValidator.validate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts a finite non-negative odometer reading', () => {
    const req = { params: {}, body: { odometer_km: 100.5 } };
    const res = {};
    const next = vi.fn();

    tripValidator.validate(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects an odometer reading that regresses below the previous reading', () => {
    const req = {
      params: {},
      body: { odometer_km: 100, last_odometer_km: 120 },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    tripValidator.validate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.stringContaining('previous reading') })
    );
  });

  it('accepts an odometer reading equal to the previous reading', () => {
    const req = {
      params: {},
      body: { odometer_km: 120, last_odometer_km: 120 },
    };
    const res = {};
    const next = vi.fn();

    tripValidator.validate(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('reads the previous odometer from the x-last-odometer-km header', () => {
    const req = {
      params: {},
      body: { odometer_km: 90 },
      headers: { 'x-last-odometer-km': '95' },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    tripValidator.validate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts the camelCase odometerKm alias', () => {
    const req = {
      params: { id: 'trip-1' },
      body: { odometerKm: 120 },
      headers: {},
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    tripValidator.validate(req, res, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('rejects a regression against the camelCase lastOdometerKm field', () => {
    const req = {
      params: { id: 'trip-1' },
      body: { odometerKm: 100, lastOdometerKm: 110 },
      headers: {},
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    tripValidator.validate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
