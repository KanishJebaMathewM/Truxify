/**
 * @openapi
 * components:
 *   schemas:
 *     BiometricChallengeRequest:
 *       type: object
 *       required:
 *         - shipment_id
 *         - freight_value_paisa
 *       properties:
 *         shipment_id:
 *           type: string
 *           description: Shipment or order identifier requiring biometric auth (alphanumeric, 1-64 chars)
 *         freight_value_paisa:
 *           type: integer
 *           description: Freight value in paisa used to evaluate threshold
 *     BiometricVerifyRequest:
 *       type: object
 *       required:
 *         - challenge_id
 *         - biometric_token
 *         - method
 *       properties:
 *         challenge_id:
 *           type: string
 *           description: 32-character hex challenge identifier
 *         biometric_token:
 *           type: string
 *           description: Base64url-encoded signed proof from device biometric
 *         method:
 *           type: string
 *           enum: [fingerprint, face_recognition]
 *     BiometricFallbackRequest:
 *       type: object
 *       required:
 *         - challenge_id
 *         - otp
 *       properties:
 *         challenge_id:
 *           type: string
 *           description: 32-character hex challenge identifier
 *         otp:
 *           type: string
 *           description: 6-digit fallback OTP
 *     BiometricThresholdRequest:
 *       type: object
 *       required:
 *         - threshold_paisa
 *       properties:
 *         threshold_paisa:
 *           type: integer
 *           description: Minimum freight value in paisa that triggers biometric auth
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import {
    requiresBiometricAuth,
    getBiometricThreshold,
    updateBiometricThreshold,
    createChallenge,
    verifyBiometric,
    verifyFallbackOtp,
    getChallengeStatus,
} from '../services/biometricAuthService.js';
import logger from '../middleware/logger.js';

const router = express.Router();

export const ALLOWED_BIOMETRIC_METHODS = Object.freeze(['fingerprint', 'face_recognition']);
export const CHALLENGE_ID_REGEX = /^[a-fA-F0-9]{32}$/;
export const SHIPMENT_ID_REGEX = /^[a-zA-Z0-9_\-:]{1,64}$/;
export const OTP_REGEX = /^\d{6}$/;
export const BASE64URL_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,4096}$/;
export const MAX_FREIGHT_VALUE_PAISA = 100_000_000_00; // ₹10,000,000 max

/**
 * Validates biometric authentication method enum.
 */
export const isValidBiometricMethod = (method) => {
    return typeof method === 'string' && ALLOWED_BIOMETRIC_METHODS.includes(method.toLowerCase());
};

/**
 * Validates 6-digit fallback OTP.
 */
export const isValidOtpFormat = (otp) => {
    if (typeof otp === 'number') otp = String(otp);
    return typeof otp === 'string' && OTP_REGEX.test(otp.trim());
};

/**
 * Validates base64url signed biometric proof token structure.
 */
export const isValidBiometricToken = (token) => {
    return typeof token === 'string' && BASE64URL_TOKEN_REGEX.test(token.trim());
};

/**
 * Validates 32-character hex challenge ID.
 */
export const isValidChallengeId = (challengeId) => {
    return typeof challengeId === 'string' && CHALLENGE_ID_REGEX.test(challengeId.trim());
};

/**
 * Validates shipment identifier format.
 */
export const isValidShipmentId = (shipmentId) => {
    return typeof shipmentId === 'string' && SHIPMENT_ID_REGEX.test(shipmentId.trim());
};

/**
 * @openapi
 * /api/biometric-auth/check:
 *   post:
 *     tags: [BiometricAuth]
 *     summary: Check if biometric auth is required
 *     description: Returns whether the given freight value triggers the user's threshold.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [freight_value_paisa]
 *             properties:
 *               freight_value_paisa:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Auth required flag
 */
router.post('/check', authenticate, userLimiter, (req, res) => {
    const { freight_value_paisa } = req.body;

    if (
        freight_value_paisa === undefined ||
        typeof freight_value_paisa !== 'number' ||
        !Number.isInteger(freight_value_paisa) ||
        freight_value_paisa < 0
    ) {
        return res.status(400).json({ error: 'freight_value_paisa must be a non-negative integer' });
    }

    if (freight_value_paisa > MAX_FREIGHT_VALUE_PAISA) {
        return res.status(400).json({ error: `freight_value_paisa exceeds maximum allowed limit of ₹${MAX_FREIGHT_VALUE_PAISA / 100}` });
    }

    const required = requiresBiometricAuth(req.user.id, freight_value_paisa);
    const { threshold_paisa } = getBiometricThreshold(req.user.id);

    return res.json({ biometric_required: required, threshold_paisa });
});

/**
 * @openapi
 * /api/biometric-auth/challenge:
 *   post:
 *     tags: [BiometricAuth]
 *     summary: Initiate a biometric authentication challenge
 *     description: Creates a time-limited challenge session and returns a nonce for device signing.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BiometricChallengeRequest'
 *     responses:
 *       201:
 *         description: Challenge created
 *       400:
 *         description: Validation error
 *       403:
 *         description: Biometric auth not required for this freight value
 */
router.post('/challenge', authenticate, userLimiter, (req, res) => {
    const { shipment_id, freight_value_paisa } = req.body;

    if (!isValidShipmentId(shipment_id)) {
        return res.status(400).json({ error: 'shipment_id must be a valid non-empty string between 1 and 64 alphanumeric characters' });
    }

    if (
        freight_value_paisa === undefined ||
        typeof freight_value_paisa !== 'number' ||
        !Number.isInteger(freight_value_paisa) ||
        freight_value_paisa < 0
    ) {
        return res.status(400).json({ error: 'freight_value_paisa must be a non-negative integer' });
    }

    if (freight_value_paisa > MAX_FREIGHT_VALUE_PAISA) {
        return res.status(400).json({ error: `freight_value_paisa exceeds maximum limit of ₹${MAX_FREIGHT_VALUE_PAISA / 100}` });
    }

    if (!requiresBiometricAuth(req.user.id, freight_value_paisa)) {
        return res.status(403).json({
            error: 'Biometric authentication not required for this freight value',
            threshold_paisa: getBiometricThreshold(req.user.id).threshold_paisa,
        });
    }

    try {
        const challenge = createChallenge(req.user.id, shipment_id.trim(), freight_value_paisa);
        return res.status(201).json({ message: 'Biometric challenge created', ...challenge });
    } catch (err) {
        logger.error({ err }, '[BiometricAuth] Failed to create challenge');
        return res.status(500).json({ error: 'Failed to create biometric challenge' });
    }
});

/**
 * @openapi
 * /api/biometric-auth/verify:
 *   post:
 *     tags: [BiometricAuth]
 *     summary: Verify biometric token against open challenge
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BiometricVerifyRequest'
 *     responses:
 *       200:
 *         description: Verification result
 *       400:
 *         description: Validation or verification failure
 */
router.post('/verify', authenticate, userLimiter, (req, res) => {
    const { challenge_id, biometric_token, method } = req.body;

    if (!isValidChallengeId(challenge_id)) {
        return res.status(400).json({ error: 'challenge_id must be a valid 32-character hexadecimal identifier' });
    }

    if (!isValidBiometricToken(biometric_token)) {
        return res.status(400).json({ error: 'biometric_token must be a valid Base64URL-encoded proof token between 16 and 4096 characters' });
    }

    if (!isValidBiometricMethod(method)) {
        return res.status(400).json({ error: `Invalid method. Must be one of: ${ALLOWED_BIOMETRIC_METHODS.join(', ')}` });
    }

    const normalizedMethod = method.toLowerCase();
    const result = verifyBiometric(challenge_id.trim(), biometric_token.trim(), normalizedMethod, req.user.id);

    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }

    return res.json({ message: 'Biometric authentication successful', ...result });
});

/**
 * @openapi
 * /api/biometric-auth/fallback:
 *   post:
 *     tags: [BiometricAuth]
 *     summary: Verify fallback OTP when biometric is unavailable
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BiometricFallbackRequest'
 *     responses:
 *       200:
 *         description: Fallback verification result
 *       400:
 *         description: Invalid OTP or expired challenge
 */
router.post('/fallback', authenticate, userLimiter, (req, res) => {
    const { challenge_id, otp } = req.body;

    if (!isValidChallengeId(challenge_id)) {
        return res.status(400).json({ error: 'challenge_id must be a valid 32-character hexadecimal identifier' });
    }

    if (!isValidOtpFormat(otp)) {
        return res.status(400).json({ error: 'otp must be a valid 6-digit numeric string' });
    }

    const normalizedOtp = String(otp).trim();
    const result = verifyFallbackOtp(challenge_id.trim(), normalizedOtp, req.user.id);

    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }

    return res.json({ message: 'Fallback OTP authentication successful', ...result });
});

/**
 * @openapi
 * /api/biometric-auth/status/{challengeId}:
 *   get:
 *     tags: [BiometricAuth]
 *     summary: Get challenge status
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: challengeId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Challenge status
 *       400:
 *         description: Invalid challengeId
 *       404:
 *         description: Challenge not found
 */
router.get('/status/:challengeId', authenticate, userLimiter, (req, res) => {
    const { challengeId } = req.params;

    if (!isValidChallengeId(challengeId)) {
        return res.status(400).json({ error: 'challengeId must be a valid 32-character hexadecimal identifier' });
    }

    const status = getChallengeStatus(challengeId.trim(), req.user.id);
    if (!status) {
        return res.status(404).json({ error: 'Challenge not found' });
    }

    return res.json(status);
});

/**
 * @openapi
 * /api/biometric-auth/threshold:
 *   get:
 *     tags: [BiometricAuth]
 *     summary: Get the current biometric auth threshold
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Current threshold
 */
router.get('/threshold', authenticate, userLimiter, (req, res) => {
    return res.json(getBiometricThreshold(req.user.id));
});

/**
 * @openapi
 * /api/biometric-auth/threshold:
 *   put:
 *     tags: [BiometricAuth]
 *     summary: Update biometric auth threshold
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BiometricThresholdRequest'
 *     responses:
 *       200:
 *         description: Updated threshold
 *       400:
 *         description: Invalid threshold value
 */
router.put('/threshold', authenticate, userLimiter, (req, res) => {
    const { threshold_paisa } = req.body;

    if (
        threshold_paisa === undefined ||
        typeof threshold_paisa !== 'number' ||
        !Number.isInteger(threshold_paisa) ||
        threshold_paisa <= 0
    ) {
        return res.status(400).json({ error: 'threshold_paisa must be a positive integer' });
    }

    if (threshold_paisa > MAX_FREIGHT_VALUE_PAISA) {
        return res.status(400).json({ error: `threshold_paisa cannot exceed maximum limit of ₹${MAX_FREIGHT_VALUE_PAISA / 100}` });
    }

    try {
        const updated = updateBiometricThreshold(req.user.id, threshold_paisa);
        return res.json({ message: 'Biometric threshold updated', ...updated });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
});

export default router;
