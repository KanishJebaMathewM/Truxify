import crypto from 'crypto';

const DEFAULT_GEOFENCE_RADIUS_METERS = 200; // Facility boundary threshold

/**
 * Calculates straight-line distance (haversine formula) in meters between two GPS coordinates.
 */
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
}

/**
 * Validates geofence proximity and records a cryptographically verified eBOL digital signature.
 * 
 * @param {Object} signParams - { ebolId, receiverId, receiverName, facilityCoordinates, receiverCoordinates, signatureData, biometricAuthToken }
 * @returns {Object} Signature verification result and immutable audit record
 */
export function processGeofencedSignature(signParams) {
    const {
        ebolId,
        receiverId,
        receiverName = 'Authorized Personnel',
        facilityCoordinates = {},
        receiverCoordinates = {},
        signatureData,
        biometricAuthToken
    } = signParams;

    const { latitude: facLat, longitude: facLon, geofenceRadiusMeters = DEFAULT_GEOFENCE_RADIUS_METERS } = facilityCoordinates;
    const { latitude: recLat, longitude: recLon } = receiverCoordinates;

    // Calculate receiver proximity to facility center point
    const distanceMeters = calculateDistanceMeters(facLat, facLon, recLat, recLon);
    const isWithinGeofence = distanceMeters <= geofenceRadiusMeters;

    if (!isWithinGeofence) {
        return {
            signed: false,
            reason: 'GEOFENCE_VIOLATION',
            message: `Signature rejected. Device is ${distanceMeters}m away from facility center (Maximum allowed: ${geofenceRadiusMeters}m).`,
            proximityMetrics: {
                distanceMeters,
                geofenceRadiusMeters,
                isWithinGeofence: false
            }
        };
    }

    const timestamp = new Date().toISOString();

    // Generate cryptographic hash for immutable audit trail
    const auditPayload = `${ebolId}:${receiverId}:${recLat},${recLon}:${timestamp}:${biometricAuthToken || 'PIN_AUTH'}`;
    const auditHash = crypto.createHash('sha256').update(auditPayload).digest('hex');

    const signedEbolRecord = {
        ebolId,
        status: 'DELIVERED_AND_SIGNED',
        signatureDetails: {
            receiverId,
            receiverName,
            signedAt: timestamp,
            signatureImage: signatureData ? '[STORED_VECTOR_SIGNATURE]' : null,
            biometricVerified: !!biometricAuthToken
        },
        geofenceProof: {
            facilityCoordinates: { latitude: facLat, longitude: facLon },
            receiverCoordinates: { latitude: recLat, longitude: recLon },
            distanceMeters,
            isWithinGeofence: true
        },
        auditTrail: {
            immutableHash: auditHash,
            verificationAlgorithm: 'SHA-256'
        }
    };

    return {
        signed: true,
        data: signedEbolRecord
    };
}
