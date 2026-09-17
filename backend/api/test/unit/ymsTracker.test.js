import { describe, it, expect } from 'vitest';
import {
  calculateDistanceMeters,
  recordTrailerDrop,
  locateTrailerInYard
} from '../../src/services/ymsTracker.js';

describe('ymsTracker Service', () => {
  describe('calculateDistanceMeters', () => {
    it('returns 0 for identical GPS coordinates', () => {
      const distance = calculateDistanceMeters(28.6139, 77.209, 28.6139, 77.209);
      expect(distance).toBe(0);
    });

    it('calculates accurate distance between known nearby coordinates', () => {
      // 0.001 deg latitude difference is ~111 meters
      const distance = calculateDistanceMeters(28.6139, 77.209, 28.6149, 77.209);
      expect(distance).toBeGreaterThan(100);
      expect(distance).toBeLessThan(125);
    });

    it('calculates accurate distance with negative coordinates', () => {
      const distance = calculateDistanceMeters(-33.8688, 151.2093, -33.8698, 151.2093);
      expect(distance).toBeGreaterThan(100);
      expect(distance).toBeLessThan(125);
    });

    it('handles equator and prime meridian coordinates (0, 0)', () => {
      const distance = calculateDistanceMeters(0, 0, 0.001, 0);
      expect(distance).toBeGreaterThan(100);
      expect(distance).toBeLessThan(125);
    });

    it('returns NaN for invalid, null, undefined, non-finite, or out-of-bounds coordinates', () => {
      expect(Number.isNaN(calculateDistanceMeters(null, 77.2, 28.6, 77.2))).toBe(true);
      expect(Number.isNaN(calculateDistanceMeters(28.6, undefined, 28.6, 77.2))).toBe(true);
      expect(Number.isNaN(calculateDistanceMeters(28.6, 77.2, 'invalid', 77.2))).toBe(true);
      expect(Number.isNaN(calculateDistanceMeters(28.6, 77.2, 28.6, Infinity))).toBe(true);
      expect(Number.isNaN(calculateDistanceMeters(NaN, 77.2, 28.6, 77.2))).toBe(true);
      expect(Number.isNaN(calculateDistanceMeters(95, 0, 0, 0))).toBe(true);
      expect(Number.isNaN(calculateDistanceMeters(0, 185, 0, 0))).toBe(true);
    });
  });

  describe('recordTrailerDrop', () => {
    it('records a high-precision GPS drop pin with default slot and zone', () => {
      const trailerId = `TRL-TEST-${Date.now()}-1`;
      const dropRecord = recordTrailerDrop({
        trailerId,
        driverId: 'DRV-101',
        facilityId: 'FAC-DELHI-01',
        latitude: 28.6139,
        longitude: 77.2090
      });

      expect(dropRecord).toBeDefined();
      expect(dropRecord.trailerId).toBe(trailerId);
      expect(dropRecord.droppedByDriverId).toBe('DRV-101');
      expect(dropRecord.facilityId).toBe('FAC-DELHI-01');
      expect(dropRecord.coordinates.latitude).toBe(28.6139);
      expect(dropRecord.coordinates.longitude).toBe(77.2090);
      expect(dropRecord.coordinates.precisionMeters).toBe(1.5);
      expect(dropRecord.yardSlotId).toBe('UNASSIGNED_SLOT');
      expect(dropRecord.zone).toBe('GENERAL_YARD');
      expect(dropRecord.droppedAt).toBeDefined();
    });

    it('records custom yardSlotId and zone when provided', () => {
      const trailerId = `TRL-TEST-${Date.now()}-2`;
      const dropRecord = recordTrailerDrop({
        trailerId,
        driverId: 'DRV-102',
        facilityId: 'FAC-MUMBAI-02',
        latitude: 19.0760,
        longitude: 72.8777,
        yardSlotId: 'SLOT-B-14',
        zone: 'COLD_STORAGE_DOCK'
      });

      expect(dropRecord.yardSlotId).toBe('SLOT-B-14');
      expect(dropRecord.zone).toBe('COLD_STORAGE_DOCK');
    });
  });

  describe('locateTrailerInYard', () => {
    it('returns found: false for unregistered trailer IDs', () => {
      const result = locateTrailerInYard('NON_EXISTENT_TRAILER_99999');
      expect(result.found).toBe(false);
      expect(result.message).toContain('No active micro-location pin found');
    });

    it('returns trailer pin details without AR navigation when driver location is omitted', () => {
      const trailerId = `TRL-TEST-${Date.now()}-3`;
      recordTrailerDrop({
        trailerId,
        driverId: 'DRV-103',
        facilityId: 'FAC-BLR-03',
        latitude: 12.9716,
        longitude: 77.5946,
        yardSlotId: 'SLOT-A-01',
        zone: 'INBOUND_STAGE'
      });

      const result = locateTrailerInYard(trailerId);
      expect(result.found).toBe(true);
      expect(result.trailerPin.trailerId).toBe(trailerId);
      expect(result.driverProximityMeters).toBeNull();
      expect(result.arGuidance.navigationSteps).toEqual([]);
      expect(result.arGuidance.targetSlot).toBe('SLOT-A-01');
      expect(result.arGuidance.zone).toBe('INBOUND_STAGE');
    });

    it('calculates proximity and provides 4-step AR guidance when driver coordinates are given', () => {
      const trailerId = `TRL-TEST-${Date.now()}-4`;
      recordTrailerDrop({
        trailerId,
        driverId: 'DRV-104',
        facilityId: 'FAC-HYD-04',
        latitude: 17.3850,
        longitude: 78.4867,
        yardSlotId: 'BAY-05',
        zone: 'CROSS_DOCK_WEST'
      });

      // Driver is ~111 meters north
      const result = locateTrailerInYard(trailerId, {
        latitude: 17.3860,
        longitude: 78.4867
      });

      expect(result.found).toBe(true);
      expect(result.driverProximityMeters).toBeGreaterThan(100);
      expect(result.driverProximityMeters).toBeLessThan(125);
      expect(result.arGuidance.navigationSteps.length).toBe(4);
      expect(result.arGuidance.navigationSteps[0]).toBe('Proceed to Yard Zone: CROSS_DOCK_WEST');
      expect(result.arGuidance.navigationSteps[1]).toBe('Navigate towards Aisle/Slot: BAY-05');
      expect(result.arGuidance.navigationSteps[2]).toContain('meters away');
      expect(result.arGuidance.navigationSteps[3]).toContain('Follow AR visual indicator');
    });

    it('handles equator/prime meridian driver coordinates (0, 0) correctly', () => {
      const trailerId = `TRL-TEST-${Date.now()}-5`;
      recordTrailerDrop({
        trailerId,
        driverId: 'DRV-105',
        facilityId: 'FAC-NULL-ISLAND',
        latitude: 0.001,
        longitude: 0,
        yardSlotId: 'ZERO-SLOT',
        zone: 'EQUATORIAL_DOCK'
      });

      const result = locateTrailerInYard(trailerId, {
        latitude: 0,
        longitude: 0
      });

      expect(result.found).toBe(true);
      expect(result.driverProximityMeters).toBeGreaterThan(100);
      expect(result.driverProximityMeters).toBeLessThan(125);
      expect(result.arGuidance.navigationSteps.length).toBe(4);
    });

    it('handles invalid or non-finite driver coordinates safely without throwing', () => {
      const trailerId = `TRL-TEST-${Date.now()}-6`;
      recordTrailerDrop({
        trailerId,
        driverId: 'DRV-106',
        facilityId: 'FAC-PUN-06',
        latitude: 18.5204,
        longitude: 73.8567
      });

      const resultWithNaN = locateTrailerInYard(trailerId, { latitude: NaN, longitude: 73.8567 });
      expect(resultWithNaN.found).toBe(true);
      expect(resultWithNaN.driverProximityMeters).toBeNull();
      expect(resultWithNaN.arGuidance.navigationSteps).toEqual([]);

      const resultWithNull = locateTrailerInYard(trailerId, null);
      expect(resultWithNull.found).toBe(true);
      expect(resultWithNull.driverProximityMeters).toBeNull();
    });
  });
});
