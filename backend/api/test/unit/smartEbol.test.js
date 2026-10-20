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

    it('calculates accurate distance between nearby coordinates', () => {
      // Approximately 111 meters apart in latitude.
      const lat1 = 28.6139;
      const lon1 = 77.209;
      const lat2 = 28.6149;
      const lon2 = 77.209;

      const distance = calculateDistanceMeters(
        lat1,
        lon1,
        lat2,
        lon2
      );

      expect(distance).toBeGreaterThan(100);
      expect(distance).toBeLessThan(125);
    });

    it('calculates distance for negative coordinates', () => {
      const distance = calculateDistanceMeters(
        -33.8688,
        151.2093,
        -33.8698,
        151.2093
      );

      expect(distance).toBeGreaterThan(100);
      expect(distance).toBeLessThan(125);
    });

    it('calculates distance from the equator and prime meridian', () => {
      const distance = calculateDistanceMeters(
        0,
        0,
        0.001,
        0
      );

      expect(distance).toBeGreaterThan(100);
      expect(distance).toBeLessThan(125);
    });

    it('returns NaN for invalid coordinates', () => {
      expect(
        Number.isNaN(
          calculateDistanceMeters(null, 77.2, 28.6, 77.2)
        )
      ).toBe(true);

      expect(
        Number.isNaN(
          calculateDistanceMeters(28.6, undefined, 28.6, 77.2)
        )
      ).toBe(true);

      expect(
        Number.isNaN(
          calculateDistanceMeters(28.6, 77.2, 'invalid', 77.2)
        )
      ).toBe(true);

      expect(
        Number.isNaN(
          calculateDistanceMeters(28.6, 77.2, 28.6, Infinity)
        )
      ).toBe(true);

      expect(
        Number.isNaN(
          calculateDistanceMeters(NaN, 77.2, 28.6, 77.2)
        )
      ).toBe(true);
    });

    it('returns NaN for coordinates outside valid GPS ranges', () => {
      expect(
        Number.isNaN(
          calculateDistanceMeters(91, 77.2, 28.6, 77.2)
        )
      ).toBe(true);

      expect(
        Number.isNaN(
          calculateDistanceMeters(28.6, 181, 28.6, 77.2)
        )
      ).toBe(true);

      expect(
        Number.isNaN(
          calculateDistanceMeters(28.6, 77.2, -91, 77.2)
        )
      ).toBe(true);

      expect(
        Number.isNaN(
          calculateDistanceMeters(28.6, 77.2, 28.6, -181)
        )
      ).toBe(true);
    });
  });

  describe('DEFAULT_GEOFENCE_RADIUS_METERS', () => {
    it('uses a default facility radius of 200 meters', () => {
      expect(DEFAULT_GEOFENCE_RADIUS_METERS).toBe(200);
    });
  });

  describe('processGeofencedSignature', () => {
    const facilityCoords = {
      latitude: 28.6139,
      longitude: 77.209,
    };

    const receiverCoordsInside = {
      latitude: 28.6143,
      longitude: 77.209,
    };

    const receiverCoordsOutside = {
      latitude: 28.6189,
      longitude: 77.209,
    };

    it('successfully processes a signature when receiver is inside the geofence', () => {
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

      expect(result.data.signatureDetails.receiverId).toBe(
        'USER-DRV-001'
      );

      expect(result.data.signatureDetails.receiverName).toBe(
        'Rajesh Kumar'
      );

      expect(result.data.signatureDetails.signatureImage).toBe(
        '[STORED_VECTOR_SIGNATURE]'
      );

      expect(result.data.signatureDetails.biometricVerified).toBe(true);

      expect(result.data.geofenceProof.isWithinGeofence).toBe(true);

      expect(
        result.data.geofenceProof.distanceMeters
      ).toBeLessThanOrEqual(DEFAULT_GEOFENCE_RADIUS_METERS);
    });

    it('propagates vector signature data correctly', () => {
      const signatureData =
        'data:image/svg+xml;base64,mock-vector-signature';

      const result = processGeofencedSignature({
        ebolId: 'EBOL-VECTOR-01',
        receiverId: 'RCV-VECTOR-01',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: receiverCoordsInside,
        signatureData,
      });

      expect(result.signed).toBe(true);

      expect(result.data.signatureDetails.signatureImage).toBe(
        '[STORED_VECTOR_SIGNATURE]'
      );
    });

    it('sets biometricVerified to true when biometric authentication is provided', () => {
      const result = processGeofencedSignature({
        ebolId: 'EBOL-BIO-01',
        receiverId: 'RCV-BIO-01',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: receiverCoordsInside,
        biometricAuthToken: 'BIO-TOKEN-123',
      });

      expect(result.signed).toBe(true);
      expect(result.data.signatureDetails.biometricVerified).toBe(true);
    });

    it('sets biometricVerified to false when biometric authentication is not provided', () => {
      const result = processGeofencedSignature({
        ebolId: 'EBOL-NO-BIO-01',
        receiverId: 'RCV-NO-BIO-01',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: receiverCoordsInside,
      });

      expect(result.signed).toBe(true);
      expect(result.data.signatureDetails.biometricVerified).toBe(false);
    });

    it('generates a valid SHA-256 cryptographic audit trail', () => {
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

      const signedAt = result.data.signatureDetails.signedAt;

      const expectedPayload =
        `EBOL-HASH-01:RCV-404:` +
        `${receiverCoordsInside.latitude},${receiverCoordsInside.longitude}:` +
        `${signedAt}:TOKEN-ABC`;

      const expectedHash = crypto
        .createHash('sha256')
        .update(expectedPayload)
        .digest('hex');

      expect(auditTrail.immutableHash).toBe(expectedHash);
    });

    it('uses PIN_AUTH as the audit trail fallback when biometric token is omitted', () => {
      const result = processGeofencedSignature({
        ebolId: 'EBOL-PIN-01',
        receiverId: 'RCV-PIN-01',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: receiverCoordsInside,
      });

      expect(result.signed).toBe(true);

      const signedAt = result.data.signatureDetails.signedAt;

      const expectedPayload =
        `EBOL-PIN-01:RCV-PIN-01:` +
        `${receiverCoordsInside.latitude},${receiverCoordsInside.longitude}:` +
        `${signedAt}:PIN_AUTH`;

      const expectedHash = crypto
        .createHash('sha256')
        .update(expectedPayload)
        .digest('hex');

      expect(result.data.auditTrail.immutableHash).toBe(
        expectedHash
      );
    });

    it('uses the default receiver name when receiverName is omitted', () => {
      const result = processGeofencedSignature({
        ebolId: 'EBOL-DEFAULT-NAME',
        receiverId: 'RCV-DEFAULT',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: receiverCoordsInside,
      });

      expect(result.signed).toBe(true);

      expect(result.data.signatureDetails.receiverName).toBe(
        'Authorized Personnel'
      );
    });

    it('uses null signature image when signatureData is omitted', () => {
      const result = processGeofencedSignature({
        ebolId: 'EBOL-NO-SIGNATURE',
        receiverId: 'RCV-NO-SIGNATURE',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: receiverCoordsInside,
      });

      expect(result.signed).toBe(true);

      expect(result.data.signatureDetails.signatureImage).toBeNull();
    });

    it('accepts a receiver exactly on the 200 meter boundary', () => {
      // Approximately 200 meters north of the facility.
      // 1 degree latitude is approximately 111,195 meters.
      const boundaryLatitude =
        facilityCoords.latitude + 200 / 111195;

      const boundaryCoordinates = {
        latitude: boundaryLatitude,
        longitude: facilityCoords.longitude,
      };

      const distance = calculateDistanceMeters(
        facilityCoords.latitude,
        facilityCoords.longitude,
        boundaryCoordinates.latitude,
        boundaryCoordinates.longitude
      );

      const result = processGeofencedSignature({
        ebolId: 'EBOL-BOUNDARY',
        receiverId: 'RCV-BOUNDARY',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: boundaryCoordinates,
      });

      expect(distance).toBeLessThanOrEqual(200);
      expect(result.signed).toBe(true);
      expect(result.data.geofenceProof.isWithinGeofence).toBe(true);
    });

    it('accepts a receiver clearly inside the geofence', () => {
      const result = processGeofencedSignature({
        ebolId: 'EBOL-INSIDE',
        receiverId: 'RCV-INSIDE',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: receiverCoordsInside,
      });

      expect(result.signed).toBe(true);
      expect(result.data.geofenceProof.distanceMeters).toBeLessThan(200);
      expect(result.data.geofenceProof.isWithinGeofence).toBe(true);
    });

    it('rejects a receiver outside the geofence with GEOFENCE_VIOLATION', () => {
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

      expect(result.proximityMetrics.geofenceRadiusMeters).toBe(
        DEFAULT_GEOFENCE_RADIUS_METERS
      );

      expect(result.proximityMetrics.distanceMeters).toBeGreaterThan(
        DEFAULT_GEOFENCE_RADIUS_METERS
      );
    });

    it('respects a custom geofence radius', () => {
      const tightResult = processGeofencedSignature({
        ebolId: 'EBOL-CUSTOM-TIGHT',
        receiverId: 'RCV-002',
        facilityCoordinates: {
          ...facilityCoords,
          geofenceRadiusMeters: 20,
        },
        receiverCoordinates: receiverCoordsInside,
      });

      expect(tightResult.signed).toBe(false);
      expect(tightResult.reason).toBe('GEOFENCE_VIOLATION');

      const generousResult = processGeofencedSignature({
        ebolId: 'EBOL-CUSTOM-LARGE',
        receiverId: 'RCV-003',
        facilityCoordinates: {
          ...facilityCoords,
          geofenceRadiusMeters: 1000,
        },
        receiverCoordinates: receiverCoordsOutside,
      });

      expect(generousResult.signed).toBe(true);
      expect(
        generousResult.data.geofenceProof.isWithinGeofence
      ).toBe(true);
    });

    it('rejects missing coordinates as a geofence violation', () => {
      const result = processGeofencedSignature({
        ebolId: 'EBOL-INVALID',
        receiverId: 'RCV-ERR',
      });

      expect(result.signed).toBe(false);
      expect(result.reason).toBe('GEOFENCE_VIOLATION');
    });

    it('rejects an empty request as a geofence violation', () => {
      const result = processGeofencedSignature();

      expect(result.signed).toBe(false);
      expect(result.reason).toBe('GEOFENCE_VIOLATION');
    });

    it('does not generate an audit trail when geofence verification fails', () => {
      const result = processGeofencedSignature({
        ebolId: 'EBOL-NO-AUDIT',
        receiverId: 'RCV-NO-AUDIT',
        facilityCoordinates: facilityCoords,
        receiverCoordinates: receiverCoordsOutside,
        biometricAuthToken: 'BIO-TOKEN',
      });

      expect(result.signed).toBe(false);
      expect(result.reason).toBe('GEOFENCE_VIOLATION');
      expect(result.data).toBeUndefined();
    });
  });
});
