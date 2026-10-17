import { describe, expect, it } from 'vitest';
import { admitStreamPing, streamPolicy, admittedSmoothed } from '../../src/services/gps/gpsStreamObservation.js';
import { admitTrajectoryPoint, boundedInteger } from '../../src/services/gps/trajectoryObservation.js';

describe('gpsStreamObservation.admitStreamPing', () => {
  const valid = { tripId: 'T1', lat: 28.6, lng: 77.2, timestamp: 1760000000000 };

  it('admits a valid ping, frozen, with defaults applied', () => {
    const p = admitStreamPing(valid);
    expect(p.tripId).toBe('T1');
    expect(p.speed).toBe(0);
    expect(p.heading).toBe(0);
    expect(p.accuracy).toBe(5);
    expect(p.driverId).toBe('unknown');
    expect(Object.isFrozen(p)).toBe(true);
  });

  it('rejects out-of-range coordinates', () => {
    expect(() => admitStreamPing({ ...valid, lat: 91 })).toThrow(TypeError);
    expect(() => admitStreamPing({ ...valid, lng: -181 })).toThrow(TypeError);
    expect(() => admitStreamPing({ ...valid, lat: NaN })).toThrow(TypeError);
  });

  it('rejects bad identifiers and non-objects', () => {
    expect(() => admitStreamPing(null)).toThrow(TypeError);
    expect(() => admitStreamPing([])).toThrow(TypeError);
    expect(() => admitStreamPing({ ...valid, tripId: '' })).toThrow(TypeError);
    expect(() => admitStreamPing({ ...valid, tripId: 'x'.repeat(257) })).toThrow(TypeError);
  });

  it('rejects impossible speed/heading/timestamp', () => {
    expect(() => admitStreamPing({ ...valid, speed: 10001 })).toThrow();
    expect(() => admitStreamPing({ ...valid, heading: 361 })).toThrow();
    expect(() => admitStreamPing({ ...valid, timestamp: -5 })).toThrow();
  });
});

describe('gpsStreamObservation.streamPolicy', () => {
  it('defaults are frozen and bounded', () => {
    const p = streamPolicy({});
    expect(p.streamKey).toBe('gps:stream:trips');
    expect(p.maxTrips).toBe(10000);
    expect(Object.isFrozen(p)).toBe(true);
  });

  it('rejects out-of-bounds options', () => {
    expect(() => streamPolicy(null)).toThrow(TypeError);
    expect(() => streamPolicy({ maxTrips: 0 })).toThrow();
    expect(() => streamPolicy({ acknowledgementTimeoutMs: 999999 })).toThrow();
    expect(() => streamPolicy({ streamKey: '  ' })).toThrow(TypeError);
  });
});

describe('gpsStreamObservation.admittedSmoothed', () => {
  it('validates smoothed coordinates', () => {
    expect(admittedSmoothed({ lat: 1, lng: 2, speedMps: 13.9 })).toEqual({ lat: 1, lng: 2, speedMps: 13.9 });
    expect(() => admittedSmoothed({ lat: 95, lng: 0, speedMps: 1 })).toThrow();
  });
});

describe('trajectoryObservation.admitTrajectoryPoint', () => {
  it('admits and freezes a valid point with snake_case mapping', () => {
    const p = admitTrajectoryPoint({ tripId: 'T1', lat: 28.6, lng: 77.2 });
    expect(p.trip_id).toBe('T1');
    expect(p.speed_mps).toBe(0);
    expect(p.road_name).toBeNull();
    expect(Object.isFrozen(p)).toBe(true);
    expect(new Date(p.recorded_at).getTime()).toBeGreaterThan(0);
  });

  it('accepts ISO/Date/ms timestamps and rejects garbage', () => {
    const iso = admitTrajectoryPoint({ tripId: 'T1', lat: 1, lng: 1, timestamp: '2026-10-14T10:00:00Z' });
    expect(iso.recorded_at).toBe('2026-10-14T10:00:00.000Z');
    const ms = admitTrajectoryPoint({ tripId: 'T1', lat: 1, lng: 1, timestamp: 1760000000000 });
    expect(new Date(ms.recorded_at).getTime()).toBe(1760000000000);
    expect(() => admitTrajectoryPoint({ tripId: 'T1', lat: 1, lng: 1, timestamp: 'yesterday' })).toThrow();
    expect(() => admitTrajectoryPoint({ tripId: 'T1', lat: 1, lng: 1, timestamp: {} })).toThrow();
  });

  it('bounds roadName length and rejects non-string', () => {
    expect(() => admitTrajectoryPoint({ tripId: 'T1', lat: 1, lng: 1, roadName: 'x'.repeat(513) })).toThrow(TypeError);
    expect(() => admitTrajectoryPoint({ tripId: 'T1', lat: 1, lng: 1, roadName: 42 })).toThrow(TypeError);
  });
});

describe('trajectoryObservation.boundedInteger', () => {
  it('returns bounded integers or the fallback, rejects out-of-domain', () => {
    expect(boundedInteger(50, 25, 'limit', 100)).toBe(50);
    expect(boundedInteger(undefined, 25, 'limit', 100)).toBe(25);
    expect(() => boundedInteger(0, 25, 'limit', 100)).toThrow(RangeError);
    expect(() => boundedInteger(101, 25, 'limit', 100)).toThrow(RangeError);
    expect(() => boundedInteger(1.5, 25, 'limit', 100)).toThrow(RangeError);
  });
});
