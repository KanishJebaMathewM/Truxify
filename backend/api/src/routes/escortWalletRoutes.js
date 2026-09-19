import express from 'express';
import { loadCredential, resolveCredentialSubject, handshake } from '../controllers/escortWalletController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

const SUBJECT_RE = /^0x[a-fA-F0-9]+$/;

const allowRoles = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions for this action' });
    }
    next();
};

/**
 * @swagger
 * /api/escorts/wallet/credential:
 *   post:
 *     summary: Issue an escort credential
 *     description: Issues a credential for the authenticated escort's wallet subject, or for an administrator.
 *     tags: [Escort Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EscortCredentialRequest'
 *     responses:
 *       201:
 *         description: Credential issued successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EscortCredentialResponse'
 *       400:
 *         description: Invalid subject, credential type, schema, or expiration.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Caller is not authorized to issue a credential for the subject.
 *       500:
 *         description: Credential issuance failed.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     EscortCredentialRequest:
 *       type: object
 *       required: [subject, credentialType, schema]
 *       properties:
 *         subject:
 *           type: string
 *           pattern: '^0x[a-fA-F0-9]+$'
 *           description: Ethereum-compatible wallet address of the credential subject.
 *         credentialType:
 *           type: string
 *           minLength: 1
 *           example: EscortCertification
 *         schema:
 *           type: object
 *           additionalProperties: true
 *           description: Credential claims/schema payload.
 *         validUntil:
 *           oneOf:
 *             - type: integer
 *               minimum: 0
 *               description: Unix timestamp in seconds.
 *             - type: string
 *               format: date-time
 *               description: ISO-8601 timestamp.
 *     EscortCredentialResponse:
 *       type: object
 *       required: [message, credentialId]
 *       properties:
 *         message:
 *           type: string
 *           example: Credential successfully issued and loaded into IdentityWallet
 *         credentialId:
 *           type: string
 */

/**
 * @swagger
 * /api/escorts/wallet/handshake:
 *   post:
 *     summary: Verify convoy escort compliance
 *     description: Checks the supplied escort wallets for valid, non-revoked credentials.
 *     tags: [Escort Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EscortHandshakeRequest'
 *     responses:
 *       200:
 *         description: Compliance result for the convoy.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EscortHandshakeResponse'
 *       400:
 *         description: Escorts must be a non-empty array of addresses.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Caller must be a driver or fleet manager.
 *       500:
 *         description: Credential verification failed.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     EscortHandshakeRequest:
 *       type: object
 *       required: [escorts]
 *       properties:
 *         escorts:
 *           type: array
 *           minItems: 1
 *           items:
 *             type: string
 *           description: Wallet addresses to verify.
 *     EscortHandshakeResponse:
 *       type: object
 *       required: [handshake, allCompliant, convoy]
 *       properties:
 *         handshake:
 *           type: string
 *           enum: [SUCCESS, FAILED]
 *         allCompliant:
 *           type: boolean
 *         convoy:
 *           type: array
 *           items:
 *             type: object
 *             required: [address, compliant]
 *             properties:
 *               address:
 *                 type: string
 *               compliant:
 *                 type: boolean
 *               reason:
 *                 type: string
 *               credentials:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [id, type, validUntil]
 *                   properties:
 *                     id:
 *                       type: string
 *                     type:
 *                       type: string
 *                     validUntil:
 *                       oneOf:
 *                         - type: string
 *                         - type: integer
 */

router.post(
    '/credential',
    authenticate,
    userLimiter,
    (req, res, next) => {
        const { subject, credentialType, schema, validUntil } = req.body || {};

        if (typeof subject !== 'string' || !SUBJECT_RE.test(subject)) {
            return res.status(400).json({ errors: [{ msg: 'Subject must be a 0x Ethereum address' }] });
        }
        if (typeof credentialType !== 'string' || credentialType.trim() === '') {
            return res.status(400).json({ errors: [{ msg: 'Credential type is required' }] });
        }
        if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
            return res.status(400).json({ errors: [{ msg: 'Schema must be a valid JSON object' }] });
        }
        if (validUntil !== undefined && (!Number.isInteger(validUntil) || validUntil < 0)) {
            return res.status(400).json({ errors: [{ msg: 'validUntil must be a non-negative unix timestamp' }] });
        }

        next();
    },
    requirePolicy('escort:issue-credential', resolveCredentialSubject),
    loadCredential
);

router.post(
    '/handshake',
    authenticate,
    userLimiter,
    allowRoles('driver', 'fleet_manager'),
    (req, res, next) => {
        const { escorts } = req.body || {};

        if (!Array.isArray(escorts) || escorts.length === 0) {
            return res.status(400).json({ errors: [{ msg: 'Escorts must be a non-empty array of addresses' }] });
        }

        next();
    },
    handshake
);

export default router;
