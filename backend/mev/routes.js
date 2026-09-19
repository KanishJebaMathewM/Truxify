import { ethers } from 'ethers';
import express from 'express';
import mevService from './mev.service.js';
import logger from '../api/src/middleware/logger.js';
import { authenticate, requirePolicy, requireRole } from '../api/src/middleware/index.js';

const router = express.Router();

// All MEV routes require an authenticated user: the escrow subsystem spends
// server funds (relayer wallet) on create/release and submits Flashbots
// bundles via the relayer, so it must never be publicly reachable (#14673).
router.use(authenticate);

// Create commitment
/**
 * @openapi
 * /api/mev/commitment:
 *   post:
 *     tags: [MEV]
 *     summary: Create an MEV commitment
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - secret
 *               - userId
 *             properties:
 *               secret:
 *                 type: string
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/mev/commitment', requirePolicy('mev:escrow'), async (req, res) => {
    try {
        const { secret, userId } = req.body;
        if (!secret) {
            return res.status(400).json({
                success: false,
                error: 'secret required'
            });
        }
        
        const result = await mevService.createCommitment(secret, userId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Commitment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create MEV protected escrow
/**
 * @openapi
 * /api/mev/escrow:
 *   post:
 *     tags: [MEV]
 *     summary: Create an MEV-protected escrow
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - driver
 *               - amount
 *               - secret
 *             properties:
 *               driver:
 *                 type: string
 *               amount:
 *                 type: string
 *               secret:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/mev/escrow', requirePolicy('mev:escrow'), async (req, res) => {
    try {
        const { driver, amount, secret } = req.body;
        if (!driver || !amount || !secret) {
            return res.status(400).json({
                success: false,
                error: 'driver, amount, and secret required'
            });
        }
        if (!ethers.isAddress(driver)) {
            return res.status(400).json({
                success: false,
                error: 'driver must be a valid Ethereum address'
            });
        }
        
        // The caller identity comes from the authenticated session, never from
        // the request body, so an attacker cannot create escrows on behalf of
        // other users or attribute drain attempts to someone else.
        const result = await mevService.createEscrow(driver, amount, secret, req.user.id);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Escrow creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Release escrow
/**
 * @openapi
 * /api/mev/release/{escrowId}:
 *   post:
 *     tags: [MEV]
 *     summary: Release an MEV-protected escrow
 *     parameters:
 *       - in: path
 *         name: escrowId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - secret
 *             properties:
 *               secret:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/mev/release/:escrowId', requirePolicy('mev:escrow'), async (req, res) => {
    try {
        const { escrowId } = req.params;
        const { secret, proof } = req.body;
        if (!secret) {
            return res.status(400).json({
                success: false,
                error: 'secret required'
            });
        }
        
        // `secret` alone is not an authorization mechanism: releaseEscrow
        // verifies the caller owns the deposit (stored against the
        // authenticated user) and that the on-chain deposit is unreleased.
        const result = await mevService.releaseEscrow(escrowId, secret, proof, req.user);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Release error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Submit Flashbots bundle
/**
 * @openapi
 * /api/mev/flashbots/{escrowId}:
 *   post:
 *     tags: [MEV]
 *     summary: Submit a Flashbots bundle
 *     parameters:
 *       - in: path
 *         name: escrowId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactions
 *             properties:
 *               transactions:
 *                 type: array
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/mev/flashbots/:escrowId', requirePolicy('mev:flashbots'), async (req, res) => {
    try {
        const { escrowId } = req.params;
        const { transactions } = req.body;
        if (!transactions) {
            return res.status(400).json({
                success: false,
                error: 'transactions required'
            });
        }
        
        const result = await mevService.submitFlashbotsBundle(escrowId, transactions);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Flashbots error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get MEV protection level
/**
 * @openapi
 * /api/mev/protection/{escrowId}:
 *   get:
 *     tags: [MEV]
 *     summary: Get MEV protection level
 *     parameters:
 *       - in: path
 *         name: escrowId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get('/mev/protection/:escrowId', requireRole(['admin']), async (req, res) => {
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
/**
 * @openapi
 * /api/mev/escrow/{escrowId}:
 *   get:
 *     tags: [MEV]
 *     summary: Get MEV escrow details
 *     parameters:
 *       - in: path
 *         name: escrowId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get('/mev/escrow/:escrowId', requireRole(['admin']), async (req, res) => {
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
/**
 * @openapi
 * /api/mev/stats:
 *   get:
 *     tags: [MEV]
 *     summary: Get MEV statistics
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get('/mev/stats', async (req, res) => {
    try {
        const stats = await mevService.getMEVStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;

// === Spec 43: ===
// === Spec 43: recover sender ===
export function recoverSender(msg, sig) {
  try {
    return ethers.verifyMessage(msg, sig);
  } catch (_) { return null; }
}

