import crypto from 'crypto';
import {
  EbolCustodyService,
  defaultCustodyService,
  CUSTODY_STATES,
  EBOL_EIP712_DOMAIN,
  EBOL_EIP712_TYPES,
} from './ebol/EbolCustodyService.js';
import { MerkleTree, sha256Hash, combineHashes } from './ebol/MerkleTree.js';

const DEFAULT_GEOFENCE_RADIUS_METERS = 200; // Facility boundary threshold

/**
 * Calculates straight-line distance (haversine formula) in meters between two GPS coordinates.
 */
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    if (
        typeof lat1 !== 'number' || typeof lon1 !== 'number' ||
        typeof lat2 !== 'number' || typeof lon2 !== 'number' ||
        !Number.isFinite(lat1) || !Number.isFinite(lon1) ||
        !Number.isFinite(lat2) || !Number.isFinite(lon2) ||
        lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90 ||
        lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180
    ) {
        return NaN;
    }
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
 * Supports both legacy biometric/vector signatures and enterprise EIP-712 cryptographic
 * non-repudiation with Merkle tamper-seal verification.
 * 
 * @param {Object} signParams - Parameters for geofenced signature verification
 * @returns {Object} Signature verification result and immutable audit record
 */
export function processGeofencedSignature(signParams = {}) {
    const {
        ebolId,
        receiverId,
        receiverName = 'Authorized Personnel',
        facilityCoordinates = {},
        receiverCoordinates = {},
        signatureData,
        biometricAuthToken,
        signerAddress,
        fromActor,
        eip712Signature,
        tamperSealProof,
        nonce,
        custodyService = defaultCustodyService,
    } = signParams;

    const { latitude: facLat, longitude: facLon, geofenceRadiusMeters = DEFAULT_GEOFENCE_RADIUS_METERS } = facilityCoordinates;
    const { latitude: recLat, longitude: recLon } = receiverCoordinates;

    // Calculate receiver proximity to facility center point
    const distanceMeters = calculateDistanceMeters(facLat, facLon, recLat, recLon);
    const isWithinGeofence = !Number.isNaN(distanceMeters) && distanceMeters <= geofenceRadiusMeters;

    if (!isWithinGeofence) {
        return {
            signed: false,
            reason: 'GEOFENCE_VIOLATION',
            message: `Signature rejected. Device is ${distanceMeters}m away from facility center (Maximum allowed: ${geofenceRadiusMeters}m).`,
            proximityMetrics: {
                distanceMeters,
                geofenceRadiusMeters,
                isWithinGeofence: false,
            },
        };
    }

    // Cryptographic verification if EIP-712 signature is supplied
    let cryptographicProof = null;
    if (eip712Signature) {
        try {
            const ebolRecord = custodyService.getEbol(ebolId);
            const currentRoot = ebolRecord ? ebolRecord.tamperSealRoot : '0x' + '0'.repeat(64);

            const recoveredAddress = custodyService.verifyCustodySignature({
                ebolId,
                fromActor: fromActor || signerAddress || receiverId,
                toActor: signerAddress || receiverId,
                fromState: ebolRecord ? ebolRecord.state : CUSTODY_STATES.IN_TRANSIT,
                toState: CUSTODY_STATES.FINAL_DISCHARGED,
                tamperSealRoot: currentRoot,
                timestamp: Math.floor(Date.now() / 1000),
                nonce: nonce || 1,
                signature: eip712Signature,
            });

            // Tamper seal check if proof provided
            let sealValid = false;
            if (tamperSealProof && tamperSealProof.leaf && tamperSealProof.proof) {
                sealValid = MerkleTree.verifyProof(tamperSealProof.proof, tamperSealProof.leaf, currentRoot);
            }

            cryptographicProof = {
                algorithm: 'secp256k1-EIP712',
                recoveredSigner: recoveredAddress,
                tamperSealVerified: sealValid,
            };
        } catch (cryptoErr) {
            return {
                signed: false,
                reason: 'CRYPTOGRAPHIC_SIGNATURE_INVALID',
                message: `Cryptographic non-repudiation check failed: ${cryptoErr.message}`,
                error: cryptoErr.message,
            };
        }
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
            biometricVerified: !!biometricAuthToken,
            signerAddress: signerAddress || null,
        },
        geofenceProof: {
            facilityCoordinates: { latitude: facLat, longitude: facLon },
            receiverCoordinates: { latitude: recLat, longitude: recLon },
            distanceMeters,
            isWithinGeofence: true,
        },
        auditTrail: {
            immutableHash: auditHash,
            verificationAlgorithm: 'SHA-256',
        },
    };

    if (cryptographicProof) {
        signedEbolRecord.cryptographicProof = cryptographicProof;
    }

    return {
        signed: true,
        data: signedEbolRecord,
    };
}

export {
    calculateDistanceMeters,
    DEFAULT_GEOFENCE_RADIUS_METERS,
    EbolCustodyService,
    defaultCustodyService,
    MerkleTree,
    sha256Hash,
    combineHashes,
    CUSTODY_STATES,
    EBOL_EIP712_DOMAIN,
    EBOL_EIP712_TYPES,
};
