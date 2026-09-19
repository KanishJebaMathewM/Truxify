import express from 'express';
import { ethers } from 'ethers';
import swapService from './swap.service.js';
import logger from '../api/src/middleware/logger.js';
import { authenticate } from '../api/src/middleware/auth.js';
import { requirePolicy } from '../api/src/middleware/requirePolicy.js';

const router = express.Router();

// Recover the wallet address that signed `message`. Throws if the signature is
// malformed so callers can reject forged/forged requests.
function recoverSigner(message, signature) {
    if (!signature) {
        throw new Error('signature required');
    }
    return ethers.verifyMessage(message, signature);
}

// ============ Mutating routes (authenticated + authorized only) ============

// Create swap
/**
 * @openapi
 * /api/swap/create:
 *   post:
 *     tags: [Atomic Swap]
 *     summary: Create an atomic swap
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - counterparty
 *               - amount
 *               - secret
 *               - signature
 *             properties:
 *               counterparty:
 *                 type: string
 *               amount:
 *                 type: string
 *               secret:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/swap/create', authenticate, requirePolicy('swap:create'), async (req, res) => {
    try {
        const { counterparty, tokenAddress, amount, secret, signature } = req.body;
        if (!counterparty || !amount) {
            return res.status(400).json({
                success: false,
                error: 'counterparty and amount required'
            });
        }
        if (!secret) {
            return res.status(400).json({
                success: false,
                error: 'secret required (client-generated, must not be reused)'
            });
        }

        // The funding wallet must be owned by the caller. We verify this
        // server-side by recovering the signer of an authorization message;
        // the recovered address must equal the requested counterparty so an
        // authenticated attacker cannot lock server funds to a wallet they do
        // not control.
        const authMessage = `Authorize atomic swap\ncounterparty:${counterparty}\namount:${amount}\ntoken:${tokenAddress || 'native'}`;
        const signer = recoverSigner(authMessage, signature);
        if (signer.toLowerCase() !== counterparty.toLowerCase()) {
            return res.status(403).json({
                success: false,
                error: 'signature does not authorize the given counterparty'
            });
        }

        const result = await swapService.createSwap(
            counterparty,
            tokenAddress,
            amount,
            secret,
            signer
        );
        // The preimage (secret) is intentionally omitted from the response.
        // Only the caller who generated it (and signed for it) may use it to
        // release the swap via /swap/execute.
        const { secret: _secret, ...safeResult } = result;
        res.json({ success: true, data: safeResult });
    } catch (error) {
        logger.error('Swap creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Execute swap
/**
 * @openapi
 * /api/swap/execute:
 *   post:
 *     tags: [Atomic Swap]
 *     summary: Execute an atomic swap
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - swapId
 *               - secret
 *               - signature
 *             properties:
 *               swapId:
 *                 type: string
 *               secret:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/swap/execute', authenticate, requirePolicy('swap:execute'), async (req, res) => {
    try {
        const { swapId, secret, signature } = req.body;
        if (!swapId || !secret) {
            return res.status(400).json({
                success: false,
                error: 'swapId and secret required'
            });
        }

        // Only the principal that funded (and is the recipient of) the swap may
        // release it. We recover the signer and require it to match the swap's
        // stored initiator before attempting the on-chain claim.
        const swap = await swapService.getSwap(swapId);
        if (!swap || !swap.sender) {
            return res.status(404).json({ success: false, error: 'swap not found' });
        }
        const releaseMessage = `Release atomic swap\n${swapId}`;
        const signer = recoverSigner(releaseMessage, signature);
        if (signer.toLowerCase() !== swap.sender.toLowerCase()) {
            return res.status(403).json({
                success: false,
                error: 'only the swap initiator may release this swap'
            });
        }

        const result = await swapService.executeSwap(swapId, secret);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Swap execution error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Refund swap
/**
 * @openapi
 * /api/swap/refund:
 *   post:
 *     tags: [Atomic Swap]
 *     summary: Refund an atomic swap
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - swapId
 *               - signature
 *             properties:
 *               swapId:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/swap/refund', authenticate, requirePolicy('swap:refund'), async (req, res) => {
    try {
        const { swapId, signature } = req.body;
        if (!swapId) {
            return res.status(400).json({
                success: false,
                error: 'swapId required'
            });
        }

        const swap = await swapService.getSwap(swapId);
        if (!swap || !swap.sender) {
            return res.status(404).json({ success: false, error: 'swap not found' });
        }
        const refundMessage = `Refund atomic swap\n${swapId}`;
        const signer = recoverSigner(refundMessage, signature);
        if (signer.toLowerCase() !== swap.sender.toLowerCase()) {
            return res.status(403).json({
                success: false,
                error: 'only the swap initiator may refund this swap'
            });
        }

        const result = await swapService.refundSwap(swapId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Swap refund error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create cross-chain swap
/**
 * @openapi
 * /api/swap/cross-chain/create:
 *   post:
 *     tags: [Atomic Swap]
 *     summary: Create a cross-chain atomic swap
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - destChainId
 *               - counterparty
 *               - amount
 *               - secret
 *               - signature
 *             properties:
 *               destChainId:
 *                 type: string
 *               counterparty:
 *                 type: string
 *               amount:
 *                 type: string
 *               secret:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/swap/cross-chain/create', authenticate, requirePolicy('swap:cross-chain:create'), async (req, res) => {
    try {
        const { destChainId, counterparty, tokenAddress, amount, secret, signature } = req.body;
        if (!destChainId || !counterparty || !amount) {
            return res.status(400).json({
                success: false,
                error: 'destChainId, counterparty, and amount required'
            });
        }
        if (!secret) {
            return res.status(400).json({
                success: false,
                error: 'secret required (client-generated, must not be reused)'
            });
        }

        const authMessage = `Authorize cross-chain swap\ncounterparty:${counterparty}\namount:${amount}\ndestChainId:${destChainId}\ntoken:${tokenAddress || 'native'}`;
        const signer = recoverSigner(authMessage, signature);
        if (signer.toLowerCase() !== counterparty.toLowerCase()) {
            return res.status(403).json({
                success: false,
                error: 'signature does not authorize the given counterparty'
            });
        }

        const result = await swapService.createCrossChainSwap(
            destChainId,
            counterparty,
            tokenAddress,
            amount,
            secret,
            signer
        );
        const { secret: _secret, ...safeResult } = result;
        res.json({ success: true, data: safeResult });
    } catch (error) {
        logger.error('Cross-chain swap creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Execute cross-chain swap
/**
 * @openapi
 * /api/swap/cross-chain/execute:
 *   post:
 *     tags: [Atomic Swap]
 *     summary: Execute a cross-chain atomic swap
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - swapId
 *               - secret
 *               - proof
 *               - signature
 *             properties:
 *               swapId:
 *                 type: string
 *               secret:
 *                 type: string
 *               proof:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/swap/cross-chain/execute', authenticate, requirePolicy('swap:cross-chain:execute'), async (req, res) => {
    try {
        const { swapId, secret, proof, signature } = req.body;
        if (!swapId || !secret || !proof) {
            return res.status(400).json({
                success: false,
                error: 'swapId, secret, and proof required'
            });
        }

        const swap = await swapService.getCrossChainSwap(swapId);
        if (!swap || !swap.sender) {
            return res.status(404).json({ success: false, error: 'swap not found' });
        }
        const releaseMessage = `Release cross-chain swap\n${swapId}`;
        const signer = recoverSigner(releaseMessage, signature);
        if (signer.toLowerCase() !== swap.sender.toLowerCase()) {
            return res.status(403).json({
                success: false,
                error: 'only the swap initiator may release this swap'
            });
        }

        const result = await swapService.executeCrossChainSwap(swapId, secret, proof);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Cross-chain swap execution error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Refund cross-chain swap
/**
 * @openapi
 * /api/swap/cross-chain/refund:
 *   post:
 *     tags: [Atomic Swap]
 *     summary: Refund a cross-chain atomic swap
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - swapId
 *               - signature
 *             properties:
 *               swapId:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/swap/cross-chain/refund', authenticate, requirePolicy('swap:cross-chain:refund'), async (req, res) => {
    try {
        const { swapId, signature } = req.body;
        if (!swapId) {
            return res.status(400).json({
                success: false,
                error: 'swapId required'
            });
        }

        const swap = await swapService.getCrossChainSwap(swapId);
        if (!swap || !swap.sender) {
            return res.status(404).json({ success: false, error: 'swap not found' });
        }
        const refundMessage = `Refund cross-chain swap\n${swapId}`;
        const signer = recoverSigner(refundMessage, signature);
        if (signer.toLowerCase() !== swap.sender.toLowerCase()) {
            return res.status(403).json({
                success: false,
                error: 'only the swap initiator may refund this swap'
            });
        }

        const result = await swapService.refundCrossChainSwap(swapId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Cross-chain swap refund error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ Read-only routes (authenticated only) ============

// Get stats
/**
 * @openapi
 * /api/swap/stats:
 *   get:
 *     tags: [Atomic Swap]
 *     summary: Get atomic swap statistics
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get('/swap/stats', authenticate, async (req, res) => {
    try {
        const stats = await swapService.getSwapStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get swap
/**
 * @openapi
 * /api/swap/{swapId}:
 *   get:
 *     tags: [Atomic Swap]
 *     summary: Get an atomic swap
 *     parameters:
 *       - in: path
 *         name: swapId
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
router.get('/swap/:swapId', authenticate, async (req, res) => {
    try {
        const { swapId } = req.params;
        const swap = await swapService.getSwap(swapId);
        res.json({ success: true, data: swap });
    } catch (error) {
        logger.error('Swap fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get cross-chain swap
/**
 * @openapi
 * /api/swap/cross-chain/{swapId}:
 *   get:
 *     tags: [Atomic Swap]
 *     summary: Get a cross-chain atomic swap
 *     parameters:
 *       - in: path
 *         name: swapId
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
router.get('/swap/cross-chain/:swapId', authenticate, async (req, res) => {
    try {
        const { swapId } = req.params;
        const swap = await swapService.getCrossChainSwap(swapId);
        res.json({ success: true, data: swap });
    } catch (error) {
        logger.error('Cross-chain swap fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
