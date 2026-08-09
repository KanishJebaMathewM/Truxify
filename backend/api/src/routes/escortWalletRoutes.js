import express from 'express';
import { body } from 'express-validator';
import { loadCredential, handshake } from '../controllers/escortWalletController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';

const router = express.Router();

// Escort drivers load their certifications, insurance, and state permits
router.post(
    '/credential',
    authenticate,
    // Typically, an authority or the escort driver themselves might issue/upload this.
    // For this feature, we'll allow authenticated users to post credentials.
    [
        body('subject').isString().notEmpty().withMessage('Subject address or DID is required'),
        body('credentialType').isString().notEmpty().withMessage('Credential type is required'),
        body('schema').isObject().withMessage('Schema must be a valid JSON object')
    ],
    loadCredential
);

// Truck drivers verify the entire convoy's legal compliance
router.post(
    '/handshake',
    authenticate,
    requireRole(['driver', 'fleet_manager']), // Only truck drivers/managers can perform handshake
    [
        body('escorts').isArray({ min: 1 }).withMessage('Escorts must be a non-empty array of addresses')
    ],
    handshake
);

export default router;
