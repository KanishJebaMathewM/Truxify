import express from 'express';
import { z } from 'zod';
import mevService from './mev.service.js';
import logger from '../api/src/middleware/logger.js';
import { authenticate } from '../api/src/middleware/auth.js';
import { validateBody, validateParams } from '../api/src/middleware/validate.js';

const router = express.Router();

const createCommitmentSchema = z.object({
    secret: z.string().min(1, 'secret is required')
});

const createEscrowSchema = z.object({
    driver: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'driver must be a valid Ethereum address'),
    amount: z.union([z.string(), z.number()]).refine(
        (value) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) && parsed > 0;
        },
        { message: 'amount must be a positive finite number' }
    ),
    secret: z.string().min(1, 'secret is required')
});

const releaseEscrowSchema = z.object({
    secret: z.string().min(1, 'secret is required'),
    proof: z.string().optional()
});

const submitFlashbotsSchema = z.object({
    transactions: z.array(z.unknown()).min(1, 'transactions must be a non-empty array')
});

const escrowIdParamsSchema = z.object({
    escrowId: z.string().min(1, 'escrowId is required')
});

// Create commitment
router.post('/mev/commitment', authenticate, validateBody(createCommitmentSchema), async (req, res) => {
    try {
        const { secret } = req.body;
        const userId = req.user.id;

        const result = await mevService.createCommitment(secret, userId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Commitment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create MEV protected escrow
router.post('/mev/escrow', authenticate, validateBody(createEscrowSchema), async (req, res) => {
    try {
        const { driver, amount, secret } = req.body;
        const userId = req.user.id;

        const result = await mevService.createEscrow(driver, amount, secret, userId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Escrow creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Release escrow
router.post('/mev/release/:escrowId', authenticate, validateParams(escrowIdParamsSchema), validateBody(releaseEscrowSchema), async (req, res) => {
    try {
        const { escrowId } = req.params;
        const { secret, proof } = req.body;

        const result = await mevService.releaseEscrow(escrowId, secret, proof);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Release error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Submit Flashbots bundle
router.post('/mev/flashbots/:escrowId', authenticate, validateParams(escrowIdParamsSchema), validateBody(submitFlashbotsSchema), async (req, res) => {
    try {
        const { escrowId } = req.params;
        const { transactions } = req.body;

        const result = await mevService.submitFlashbotsBundle(escrowId, transactions);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Flashbots error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get MEV protection level
router.get('/mev/protection/:escrowId', authenticate, validateParams(escrowIdParamsSchema), async (req, res) => {
    try {
        const { escrowId } = req.params;
        const result = await mevService.getMEVProtectionLevel(escrowId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Protection level error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get escrow details
router.get('/mev/escrow/:escrowId', authenticate, validateParams(escrowIdParamsSchema), async (req, res) => {
    try {
        const { escrowId } = req.params;
        const result = await mevService.getEscrowDetails(escrowId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Escrow details error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get MEV stats
router.get('/mev/stats', authenticate, async (req, res) => {
    try {
        const stats = await mevService.getMEVStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;