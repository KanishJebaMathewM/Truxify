import crypto from 'crypto';
import logger from '../middleware/logger.js';

/**
 * Backend session store for biometric authentication challenges.
 *
 * The client (mobile app) performs the actual biometric scan using the device's
 * local auth (fingerprint / Face ID). It then forwards a signed biometric token
 * to the backend. The backend verifies the token cryptographic structure,
 * checks the challenge expiry, and authorises the high-value shipment.
 *
 * For environments without a dedicated biometric-token signing service (e.g.
 * Firebase App Check, Apple DeviceCheck, or Google SafetyNet), the service
 * accepts a structured proof payload and applies HMAC-based integrity
 * verification using a shared app secret — a practical pattern for React Native
 * and Flutter apps that cannot yet integrate a full attestation provider.
 */

// Minimum freight value (in paisa) that requires biometric verification.
const DEFAULT_THRESHOLD_PAISA = Number(process.env.BIOMETRIC_FREIGHT_THRESHOLD_PAISA) || 5_000_000; // ₹50,000

// Challenge time-to-live in milliseconds.
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Number of OTP fallback digits.
const FALLBACK_OTP_DIGITS = 6;

// Per-user threshold overrides (in-process; a production deployment would
// persist these in Supabase).
const userThresholds = new Map();

// Active challenge sessions keyed by challengeId.
const challengeSessions = new Map();

// ============================================================================
// Helpers
// ============================================================================

function generateChallengeId() {
    return crypto.randomBytes(16).toString('hex');
}

function generateNonce() {
    return crypto.randomBytes(32).toString('hex');
}

function generateFallbackOtp() {
    const digits = Math.floor(Math.random() * 10 ** FALLBACK_OTP_DIGITS);
    return String(digits).padStart(FALLBACK_OTP_DIGITS, '0');
}

function isExpired(session) {
    return Date.now() > session.expiresAt;
}

/**
 * Verify a biometric proof token sent by the client.
 *
 * Token structure (JSON, Base64url-encoded):
 *   { userId, nonce, method, timestamp, signature }
 *
 * The signature is HMAC-SHA256(userId + nonce + method + timestamp, APP_SECRET).
 * This gives integrity assurance without a full attestation provider.
 */
function verifyBiometricToken(token, session, method) {
    try {
        const raw = Buffer.from(token, 'base64url').toString('utf8');
        const proof = JSON.parse(raw);

        if (
            proof.userId !== session.userId ||
            proof.nonce !== session.nonce ||
            proof.method !== method
        ) {
            return { valid: false, reason: 'Token payload mismatch' };
        }

        const ageSecs = (Date.now() - Number(proof.timestamp)) / 1000;
        if (ageSecs > 300) {
            return { valid: false, reason: 'Token timestamp too old' };
        }

        const secret = process.env.BIOMETRIC_APP_SECRET || 'truxify-biometric-secret';
        const expected = crypto
            .createHmac('sha256', secret)
            .update(`${proof.userId}${proof.nonce}${proof.method}${proof.timestamp}`)
            .digest('hex');

        const valid = crypto.timingSafeEqual(
            Buffer.from(proof.signature, 'hex'),
            Buffer.from(expected, 'hex')
        );

        return valid
            ? { valid: true }
            : { valid: false, reason: 'Signature verification failed' };
    } catch {
        return { valid: false, reason: 'Malformed biometric token' };
    }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check whether a given freight value requires biometric authentication.
 */
export function requiresBiometricAuth(userId, freightValuePaisa) {
    const threshold = userThresholds.get(userId) ?? DEFAULT_THRESHOLD_PAISA;
    return freightValuePaisa >= threshold;
}

/**
 * Get the active threshold for a user (in paisa).
 */
export function getBiometricThreshold(userId) {
    return {
        threshold_paisa: userThresholds.get(userId) ?? DEFAULT_THRESHOLD_PAISA,
        default_threshold_paisa: DEFAULT_THRESHOLD_PAISA,
    };
}

/**
 * Update the freight-value threshold for a user.
 * Minimum 1 paisa; maximum ₹10,00,000 (₹10 lakh).
 */
export function updateBiometricThreshold(userId, thresholdPaisa) {
    const parsed = Number(thresholdPaisa);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000_000) {
        throw new Error('threshold_paisa must be an integer between 1 and 100000000');
    }
    userThresholds.set(userId, parsed);
    logger.info(`[BiometricAuth] Threshold updated for user ${userId}: ${parsed} paisa`);
    return getBiometricThreshold(userId);
}

/**
 * Create a biometric authentication challenge for a shipment.
 *
 * Returns a challengeId, a one-time nonce (sent to the client for token
 * signing), and the set of supported authentication methods.
 */
export function createChallenge(userId, shipmentId, freightValuePaisa) {
    const challengeId = generateChallengeId();
    const nonce = generateNonce();
    const fallbackOtp = generateFallbackOtp();
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;

    challengeSessions.set(challengeId, {
        challengeId,
        userId,
        shipmentId,
        freightValuePaisa,
        nonce,
        fallbackOtp,
        expiresAt,
        status: 'pending',
        method: null,
        verifiedAt: null,
    });

    logger.info(
        `[BiometricAuth] Challenge created for user ${userId}, shipment ${shipmentId} (value: ${freightValuePaisa} paisa)`
    );

    return {
        challengeId,
        nonce,
        expiresAt,
        supported_methods: ['fingerprint', 'face_recognition'],
        fallback_available: true,
    };
}

/**
 * Verify a biometric token sent by the client against the open challenge.
 *
 * @param {string} challengeId
 * @param {string} biometricToken  – Base64url-encoded proof payload from device
 * @param {'fingerprint'|'face_recognition'} method
 */
export function verifyBiometric(challengeId, biometricToken, method) {
    const session = challengeSessions.get(challengeId);

    if (!session) {
        return { success: false, error: 'Challenge not found or already consumed' };
    }
    if (session.status !== 'pending') {
        return { success: false, error: `Challenge already ${session.status}` };
    }
    if (isExpired(session)) {
        session.status = 'expired';
        return { success: false, error: 'Challenge has expired' };
    }

    const VALID_METHODS = ['fingerprint', 'face_recognition'];
    if (!VALID_METHODS.includes(method)) {
        return { success: false, error: `Unsupported method. Allowed: ${VALID_METHODS.join(', ')}` };
    }

    const result = verifyBiometricToken(biometricToken, session, method);
    if (!result.valid) {
        logger.warn(`[BiometricAuth] Biometric verification failed for challenge ${challengeId}: ${result.reason}`);
        return { success: false, error: result.reason };
    }

    session.status = 'verified';
    session.method = method;
    session.verifiedAt = new Date().toISOString();

    logger.info(
        `[BiometricAuth] Challenge ${challengeId} verified via ${method} for user ${session.userId}`
    );

    return {
        success: true,
        challengeId,
        method,
        verifiedAt: session.verifiedAt,
        shipmentId: session.shipmentId,
    };
}

/**
 * Fallback: verify a one-time OTP instead of biometrics.
 * The OTP is delivered out-of-band (SMS / in-app notification) by the caller.
 */
export function verifyFallbackOtp(challengeId, otp) {
    const session = challengeSessions.get(challengeId);

    if (!session) {
        return { success: false, error: 'Challenge not found or already consumed' };
    }
    if (session.status !== 'pending') {
        return { success: false, error: `Challenge already ${session.status}` };
    }
    if (isExpired(session)) {
        session.status = 'expired';
        return { success: false, error: 'Challenge has expired' };
    }

    const otpStr = String(otp).trim();
    if (otpStr.length !== FALLBACK_OTP_DIGITS || !/^\d+$/.test(otpStr)) {
        return { success: false, error: `OTP must be exactly ${FALLBACK_OTP_DIGITS} digits` };
    }

    const match = crypto.timingSafeEqual(
        Buffer.from(otpStr),
        Buffer.from(session.fallbackOtp)
    );

    if (!match) {
        logger.warn(`[BiometricAuth] Fallback OTP mismatch for challenge ${challengeId}`);
        return { success: false, error: 'Invalid OTP' };
    }

    session.status = 'verified';
    session.method = 'fallback_otp';
    session.verifiedAt = new Date().toISOString();

    logger.info(
        `[BiometricAuth] Challenge ${challengeId} verified via fallback OTP for user ${session.userId}`
    );

    return {
        success: true,
        challengeId,
        method: 'fallback_otp',
        verifiedAt: session.verifiedAt,
        shipmentId: session.shipmentId,
    };
}

/**
 * Get the fallback OTP for a pending challenge (so the caller can deliver it).
 * Only callable server-side — never exposed directly to clients.
 */
export function getFallbackOtp(challengeId) {
    const session = challengeSessions.get(challengeId);
    if (!session || session.status !== 'pending' || isExpired(session)) return null;
    return session.fallbackOtp;
}

/**
 * Check the current status of a challenge without consuming it.
 */
export function getChallengeStatus(challengeId, userId) {
    const session = challengeSessions.get(challengeId);
    if (!session) return null;
    if (session.userId !== userId) return null;

    if (session.status === 'pending' && isExpired(session)) {
        session.status = 'expired';
    }

    return {
        challengeId: session.challengeId,
        status: session.status,
        method: session.method,
        shipmentId: session.shipmentId,
        expiresAt: session.expiresAt,
        verifiedAt: session.verifiedAt,
    };
}

export function getChallenge(challengeId) {
    return challengeSessions.get(challengeId);
}
