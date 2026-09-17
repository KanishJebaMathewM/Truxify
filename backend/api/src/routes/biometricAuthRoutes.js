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
 *           description: Shipment or order identifier requiring biometric auth
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

    if (freight_value_paisa === undefined || typeof freight_value_paisa !== 'number' || !Number.isInteger(freight_value_paisa) || freight_value_paisa < 0) {
        return res.status(400).json({ error: 'freight_value_paisa must be a non-negative integer' });
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

    if (!shipment_id || typeof shipment_id !== 'string' || shipment_id.trim().length === 0) {
        return res.status(400).json({ error: 'shipment_id is required' });
    }
    if (freight_value_paisa === undefined || typeof freight_value_paisa !== 'number' || !Number.isInteger(freight_value_paisa) || freight_value_paisa < 0) {
        return res.status(400).json({ error: 'freight_value_paisa must be a non-negative integer' });
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

    if (!challenge_id || typeof challenge_id !== 'string') {
        return res.status(400).json({ error: 'challenge_id is required' });
    }
    if (!biometric_token || typeof biometric_token !== 'string') {
        return res.status(400).json({ error: 'biometric_token is required' });
    }
    if (!method || typeof method !== 'string') {
        return res.status(400).json({ error: 'method is required' });
    }

    const result = verifyBiometric(challenge_id, biometric_token, method, req.user.id);

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

    if (!challenge_id || typeof challenge_id !== 'string') {
        return res.status(400).json({ error: 'challenge_id is required' });
    }
    if (otp === undefined || otp === null) {
        return res.status(400).json({ error: 'otp is required' });
    }

    const result = verifyFallbackOtp(challenge_id, String(otp), req.user.id);

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
 *       404:
 *         description: Challenge not found
 */
router.get('/status/:challengeId', authenticate, userLimiter, (req, res) => {
    const { challengeId } = req.params;

    const status = getChallengeStatus(challengeId, req.user.id);
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

    if (threshold_paisa === undefined) {
        return res.status(400).json({ error: 'threshold_paisa is required' });
    }

    try {
        const updated = updateBiometricThreshold(req.user.id, threshold_paisa);
        return res.json({ message: 'Biometric threshold updated', ...updated });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
});

export default router;
