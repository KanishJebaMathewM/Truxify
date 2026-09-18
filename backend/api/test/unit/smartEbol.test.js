import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  processGeofencedSignature,
  calculateDistanceMeters,
  DEFAULT_GEOFENCE_RADIUS_METERS,
} from '../../src/services/smartEbol.js';

describe('smartEbol Service', () => {
  describe('calculateDistanceMeters', () => {
    it('returns 0 for identical GPS coordinates', () => {
      const lat = 28.6139;
      const lon = 77.209;
      const distance = calculateDistanceMeters(lat, lon, lat, lon);
      expect(distance).toBe(0);
    });

    it('calculates accurate distance between known nearby coordinates', () => {
      // Coordinates approx 111 meters apart in latitude (0.001 deg lat ~ 111m)
      const lat1 = 28.6139;
      const lon1 = 77.209;
      const lat2 = 28.6149;
      const lon2 = 77.209;
      const distance = calculateDistanceMeters(lat1, lon1, lat2, lon2);
      expect(distance).toBeGreaterThan(100);
      expect(distance).toBeLessThan(125);
    });

    it('calculates accurate distance across negative coordinates and hemisphere crossings', () => {
      const distance = calculateDistanceMeters(-33.8688, 151.2093, -33.8698, 151.2093);
      expect(distance).toBeGreaterThan(100);
      expect(distance).toBeLessThan(125);
    });

    it('handles equator and prime meridian coordinates (0, 0)', () => {
      const distance = calculateDistanceMeters(0, 0, 0.001, 0);
      expect(distance).toBeGreaterThan(100);
      expect(distance).toBeLessThan(125);
    });

    it('returns NaN for non-numeric, null, undefined, or non-finite inputs', () => {
      expect(Number.isNaN(calculateDistanceMeters(null, 77.2, 28.6, 77.2))).toBe(true);
      expect(Number.isNaN(calculateDistanceMeters(28.6, undefined, 28.6, 77.2))).toBe(true);
      expect(Number.isNaN(calculateDistanceMeters(28.6, 77.2, 'invalid', 77.2))).toBe(true);
      expect(Number.isNaN(calculateDistanceMeters(28.6, 77.2, 28.6, Infinity))).toBe(true);
      expect(Number.isNaN(calculateDistanceMeters(NaN, 77.2, 28.6, 77.2))).toBe(true);
    });
  });

  describe('DEFAULT_GEOFENCE_RADIUS_METERS', () => {
    it('defines a default facility radius of 200 meters', () => {
      expect(DEFAULT_GEOFENCE_RADIUS_METERS).toBe(200);
    });
  });

  describe('processGeofencedSignature', () => {
    const facilityCoords = { latitude: 28.6139, longitude: 77.209 };
    // Approx 50 meters away (well within 200m default radius)
    const receiverCoordsInside = { latitude: 28.6143, longitude: 77.209 };
    // Approx 550 meters away (well outside 200m default radius)
    const receiverCoordsOutside = { latitude: 28.6189, longitude: 77.209 };

    it('successfully processes eBOL signature when receiver is inside facility geofence', () => {
      const result = processGeofencedSignature({
        ebolId: 'EBOL-9921',
        receiverId: 'USER-DRV-001',
        receiverName: 'Rajesh Kumar',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: receiverCoordsInside,
        signatureData: 'data:image/png;base64,mockvector',
        biometricAuthToken: 'BIO-SECURE-TOKEN-123',
      });

      expect(result.signed).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.ebolId).toBe('EBOL-9921');
      expect(result.data.status).toBe('DELIVERED_AND_SIGNED');
      expect(result.data.signatureDetails.receiverId).toBe('USER-DRV-001');
      expect(result.data.signatureDetails.receiverName).toBe('Rajesh Kumar');
      expect(result.data.signatureDetails.signatureImage).toBe('[STORED_VECTOR_SIGNATURE]');
      expect(result.data.signatureDetails.biometricVerified).toBe(true);
      expect(result.data.geofenceProof.isWithinGeofence).toBe(true);
      expect(result.data.geofenceProof.distanceMeters).toBeLessThanOrEqual(200);
    });

    it('generates a verified SHA-256 cryptographic audit trail', () => {
      const result = processGeofencedSignature({
        ebolId: 'EBOL-HASH-01',
        receiverId: 'RCV-404',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: receiverCoordsInside,
        biometricAuthToken: 'TOKEN-ABC',
      });

      expect(result.signed).toBe(true);
      const auditTrail = result.data.auditTrail;
      expect(auditTrail.verificationAlgorithm).toBe('SHA-256');
      expect(auditTrail.immutableHash).toMatch(/^[a-f0-9]{64}$/);

      // Recreate expected hash using timestamp from signatureDetails
      const signedAt = result.data.signatureDetails.signedAt;
      const expectedPayload = `EBOL-HASH-01:RCV-404:${receiverCoordsInside.latitude},${receiverCoordsInside.longitude}:${signedAt}:TOKEN-ABC`;
      const expectedHash = crypto.createHash('sha256').update(expectedPayload).digest('hex');
      expect(auditTrail.immutableHash).toBe(expectedHash);
    });

    it('falls back to default receiverName and PIN_AUTH when optional fields are omitted', () => {
      const result = processGeofencedSignature({
        ebolId: 'EBOL-DEFAULTS',
        receiverId: 'RCV-DEFAULT-01',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: receiverCoordsInside,
      });

      expect(result.signed).toBe(true);
      expect(result.data.signatureDetails.receiverName).toBe('Authorized Personnel');
      expect(result.data.signatureDetails.signatureImage).toBeNull();
      expect(result.data.signatureDetails.biometricVerified).toBe(false);

      const signedAt = result.data.signatureDetails.signedAt;
      const expectedPayload = `EBOL-DEFAULTS:RCV-DEFAULT-01:${receiverCoordsInside.latitude},${receiverCoordsInside.longitude}:${signedAt}:PIN_AUTH`;
      const expectedHash = crypto.createHash('sha256').update(expectedPayload).digest('hex');
      expect(result.data.auditTrail.immutableHash).toBe(expectedHash);
    });

    it('respects a custom geofenceRadiusMeters parameter', () => {
      // Custom tight radius of 20 meters (receiver is ~44 meters away, so should be rejected)
      const tightResult = processGeofencedSignature({
        ebolId: 'EBOL-CUSTOM-RAD',
        receiverId: 'RCV-002',
        facilityCoordinates: { ...facilityCoords, geofenceRadiusMeters: 20 },
        receiverCoordinates: receiverCoordsInside,
      });
      expect(tightResult.signed).toBe(false);
      expect(tightResult.reason).toBe('GEOFENCE_VIOLATION');

      // Custom large radius of 1000 meters (receiver is ~550 meters away, so should be accepted)
      const generousResult = processGeofencedSignature({
        ebolId: 'EBOL-CUSTOM-RAD',
        receiverId: 'RCV-002',
        facilityCoordinates: { ...facilityCoords, geofenceRadiusMeters: 1000 },
        receiverCoordinates: receiverCoordsOutside,
      });
      expect(generousResult.signed).toBe(true);
      expect(generousResult.data.geofenceProof.isWithinGeofence).toBe(true);
    });

    it('rejects signature when receiver device is outside geofence boundary', () => {
      const result = processGeofencedSignature({
        ebolId: 'EBOL-VIOLATION',
        receiverId: 'USER-FAR-AWAY',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: receiverCoordsOutside,
      });

      expect(result.signed).toBe(false);
      expect(result.reason).toBe('GEOFENCE_VIOLATION');
      expect(result.message).toContain('Signature rejected');
      expect(result.proximityMetrics).toBeDefined();
      expect(result.proximityMetrics.isWithinGeofence).toBe(false);
      expect(result.proximityMetrics.geofenceRadiusMeters).toBe(200);
      expect(result.proximityMetrics.distanceMeters).toBeGreaterThan(200);
    });

    it('rejects signature when called with missing or invalid coordinates', () => {
      const resultNoCoords = processGeofencedSignature({
        ebolId: 'EBOL-INVALID',
        receiverId: 'RCV-ERR',
      });
      expect(resultNoCoords.signed).toBe(false);
      expect(resultNoCoords.reason).toBe('GEOFENCE_VIOLATION');

      const resultEmpty = processGeofencedSignature();
      expect(resultEmpty.signed).toBe(false);
      expect(resultEmpty.reason).toBe('GEOFENCE_VIOLATION');
    });
  });
});
