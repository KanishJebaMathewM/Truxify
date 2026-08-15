import express from 'express';
import { loadCredential, resolveCredentialSubject, handshake } from '../controllers/escortWalletController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';

const router = express.Router();

const SUBJECT_RE = /^0x[a-fA-F0-9]+$/;

// Only truck drivers/managers may perform a convoy compliance handshake
const allowRoles = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions for this action' });
    }
    next();
};

// Escort drivers load their certifications, insurance, and state permits.
// Only the wallet owner (or an admin) may issue a credential for a subject.
router.post(
    '/credential',
    authenticate,
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
    // Only the escort driver themselves (for their own wallet address) or an
    // administrator may issue a credential — never any authenticated user for
    // an arbitrary subject.
    requirePolicy('escort:issue-credential', resolveCredentialSubject),
    loadCredential
);

// Truck drivers verify the entire convoy's legal compliance
router.post(
    '/handshake',
    authenticate,
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
