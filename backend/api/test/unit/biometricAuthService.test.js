import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    getChallengeStatus,
    getFallbackOtp,
    requiresBiometricAuth,
    updateBiometricThreshold,
    createChallenge,
    getChallenge,
    verifyFallbackOtp,
    verifyBiometric,
} from '../../src/services/biometricAuthService.js';

const FALLBACK_SECRET = 'truxify-biometric-secret';
const CONFIGURED_SECRET = 'test-biometric-secret';

function createBiometricToken(session, secret, method = 'fingerprint') {
    const timestamp = Date.now();
    const payload = {
        userId: session.userId,
        nonce: session.nonce,
        method,
        timestamp,
    };

    payload.signature = crypto
        .createHmac('sha256', secret)
        .update(`${payload.userId}${payload.nonce}${payload.method}${payload.timestamp}`)
        .digest('hex');

    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

describe('biometricAuthService', () => {
    let originalSecret;

    beforeEach(() => {
        originalSecret = process.env.BIOMETRIC_APP_SECRET;
        delete process.env.BIOMETRIC_APP_SECRET;
    });

    afterEach(() => {
        if (originalSecret === undefined) {
            delete process.env.BIOMETRIC_APP_SECRET;
        } else {
            process.env.BIOMETRIC_APP_SECRET = originalSecret;
        }
    });

    it('rejects biometric proofs when no app secret is configured', () => {
        const challenge = createChallenge('user-1', 'shipment-1', 5_000_000);
        const session = getChallenge(challenge.challengeId);
        const token = createBiometricToken(session, FALLBACK_SECRET);

        const result = verifyBiometric(challenge.challengeId, token, 'fingerprint');

        expect(result).toEqual({
            success: false,
            error: 'Biometric token verification is not configured',
        });
    });

    it('rejects the historical public fallback secret when configuration is missing', () => {
        const challenge = createChallenge('user-2', 'shipment-2', 5_000_000);
        const session = getChallenge(challenge.challengeId);
        const token = createBiometricToken(session, FALLBACK_SECRET);

        const result = verifyBiometric(challenge.challengeId, token, 'fingerprint');

        expect(result.success).toBe(false);
        expect(result.error).not.toBe('Signature verification failed');
        expect(result.error).toBe('Biometric token verification is not configured');
    });

    it('accepts a valid proof when the app secret is configured', () => {
        process.env.BIOMETRIC_APP_SECRET = CONFIGURED_SECRET;

        const challenge = createChallenge('user-3', 'shipment-3', 5_000_000);
        const session = getChallenge(challenge.challengeId);
        const token = createBiometricToken(session, CONFIGURED_SECRET);

        const result = verifyBiometric(challenge.challengeId, token, 'fingerprint');

        expect(result.success).toBe(true);
        expect(result.challengeId).toBe(challenge.challengeId);
        expect(result.method).toBe('fingerprint');
    });

    it('rejects a proof signed with a different secret', () => {
        process.env.BIOMETRIC_APP_SECRET = CONFIGURED_SECRET;

        const challenge = createChallenge('user-4', 'shipment-4', 5_000_000);
        const session = getChallenge(challenge.challengeId);
        const token = createBiometricToken(session, 'wrong-secret');

        const result = verifyBiometric(challenge.challengeId, token, 'fingerprint');

        expect(result).toEqual({
            success: false,
            error: 'Signature verification failed',
        });
    });

    it('treats a whitespace-only secret as unconfigured', () => {
        process.env.BIOMETRIC_APP_SECRET = '   ';

        const challenge = createChallenge('user-5', 'shipment-5', 5_000_000);
        const session = getChallenge(challenge.challengeId);
        const token = createBiometricToken(session, FALLBACK_SECRET);

        const result = verifyBiometric(challenge.challengeId, token, 'fingerprint');

        expect(result).toEqual({
            success: false,
            error: 'Biometric token verification is not configured',
        });
    });

    it('evaluates freight value against the configured threshold', () => {
        updateBiometricThreshold('driver-bio-test-1', 5_000_000);

        expect(requiresBiometricAuth('driver-bio-test-1', 4_999_999)).toBe(false);
        expect(requiresBiometricAuth('driver-bio-test-1', 5_000_000)).toBe(true);
    });

    it('updates and validates biometric thresholds', () => {
        const updated = updateBiometricThreshold('driver-bio-test-1', 2_000_000);

        expect(updated.threshold_paisa).toBe(2_000_000);
        expect(() => updateBiometricThreshold('driver-bio-test-1', 0)).toThrow();
        expect(() => updateBiometricThreshold('driver-bio-test-1', 'invalid')).toThrow();
    });

    it('creates a challenge and exposes a pending status to its owner', () => {
        const challenge = createChallenge('driver-bio-test-1', 'shipment-999', 6_000_000);

        expect(challenge.challengeId).toBeDefined();
        expect(challenge.nonce).toBeDefined();
        expect(getChallengeStatus(challenge.challengeId, 'driver-bio-test-1')).toMatchObject({
            status: 'pending',
            shipmentId: 'shipment-999',
        });
    });

    it('verifies a fallback OTP and consumes the challenge', () => {
        const challenge = createChallenge('driver-bio-test-1', 'shipment-999', 6_000_000);
        const result = verifyFallbackOtp(challenge.challengeId, getFallbackOtp(challenge.challengeId));

        expect(result.success).toBe(true);
        expect(result.method).toBe('fallback_otp');
        expect(getChallenge(challenge.challengeId).status).toBe('verified');
    });

    it('rejects an incorrect fallback OTP', () => {
        const challenge = createChallenge('driver-bio-test-1', 'shipment-999', 6_000_000);

        expect(verifyFallbackOtp(challenge.challengeId, '000000')).toEqual({
            success: false,
            error: 'Invalid OTP',
        });
    });
});
