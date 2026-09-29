import express from 'express';
import tokenService from './token.service.js';
import logger from '../api/src/middleware/logger.js';
import { authenticate } from '../api/src/middleware/auth.js';
import { requirePolicy } from '../api/src/middleware/requirePolicy.js';
import { supabase } from '../api/src/config/db.js';
import { ethers } from 'ethers';

const router = express.Router();

/**
 * Resolve the authenticated user's verified on-chain address.
 *
 * The wallet address is NEVER taken from the request body (that allowed ledger
 * spoofing). Instead it is read from the user's verified profile row, which is
 * only reachable once `authenticate` has populated `req.user`.
 */
async function resolveVerifiedUserAddress(req) {
    if (!req.user || !req.user.id) {
        throw new Error('Missing authenticated user context.');
    }

    const { data: profile, error } = await supabase
        .from('profiles')
        .select('polygon_wallet_address')
        .eq('id', req.user.id)
        .maybeSingle();

    if (error) {
        throw new Error('Failed to resolve user wallet address.');
    }

    const address = profile?.polygon_wallet_address;
    if (!address || !ethers.isAddress(address)) {
        throw new Error('Authenticated user has no verified wallet address on file.');
    }

    return address.toLowerCase();
}

/**
 * Verify that the request carries a valid personal signature over the intended
 * operation, and that the recovered signer matches the verified user address.
 *
 * This binds every value-bearing mutation to the user's own wallet, so the
 * server relayer can only act on operations the user explicitly authorized.
 */
function verifyOperationSignature(req, action, fields) {
    const signature = req.body?.signature;
    if (!signature || typeof signature !== 'string') {
        throw new Error('A signature authorizing this operation is required.');
    }

    const verifiedAddress = req.verifiedUserAddress;
    if (!verifiedAddress) {
        throw new Error('User address has not been verified.');
    }

    const payload = [
        'Truxify token operation',
        `action:${action}`,
        ...fields.map(([k, v]) => `${k}:${v}`),
        `userAddress:${verifiedAddress}`,
    ].join('\n');

    let recovered;
    try {
        recovered = ethers.verifyMessage(payload, signature);
    } catch {
        throw new Error('Invalid operation signature.');
    }

    if (recovered.toLowerCase() !== verifiedAddress) {
        throw new Error('Operation signature does not match the verified user address.');
    }
}

// Create asset
router.post(
/**
 * @openapi
 * /api/token/asset/create:
 *   post:
 *     tags: [Tokenization]
 *     summary: Create a tokenized freight asset
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - assetType
 *               - signature
 *             properties:
 *               name:
 *                 type: string
 *               assetType:
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
    '/token/asset/create',
    authenticate,
    requirePolicy('token:create-asset'),
    async (req, res) => {
        try {
            req.verifiedUserAddress = await resolveVerifiedUserAddress(req);
            verifyOperationSignature(req, 'token/asset/create', [
                ['name', req.body?.name ?? ''],
                ['assetType', req.body?.assetType ?? ''],
            ]);

            const result = await tokenService.createAsset(req.body);
            res.json({ success: true, data: result });
        } catch (error) {
            logger.error('Asset creation error:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    }
);

// Purchase fraction
router.post(
/**
 * @openapi
 * /api/token/fraction/purchase:
 *   post:
 *     tags: [Tokenization]
 *     summary: Purchase a fraction of a tokenized asset
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - assetId
 *               - amount
 *               - signature
 *             properties:
 *               assetId:
 *                 type: string
 *               amount:
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
    '/token/fraction/purchase',
    authenticate,
    requirePolicy('token:purchase-fraction'),
    async (req, res) => {
        try {
            const { assetId, amount } = req.body;
            if (!assetId || !amount) {
                return res.status(400).json({
                    success: false,
                    error: 'assetId and amount required',
                });
            }

            req.verifiedUserAddress = await resolveVerifiedUserAddress(req);
            verifyOperationSignature(req, 'token/fraction/purchase', [
                ['assetId', assetId],
                ['amount', amount],
            ]);

            const signer = tokenService.getRelayerSigner(req.verifiedUserAddress);
            const result = await tokenService.purchaseFraction(
                assetId,
                amount,
                req.verifiedUserAddress,
                signer
            );
            res.json({ success: true, data: result });
        } catch (error) {
            logger.error('Fraction purchase error:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    }
);

// Sell fraction
router.post(
/**
 * @openapi
 * /api/token/fraction/sell:
 *   post:
 *     tags: [Tokenization]
 *     summary: Sell a fraction of a tokenized asset
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - assetId
 *               - amount
 *               - signature
 *             properties:
 *               assetId:
 *                 type: string
 *               amount:
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
    '/token/fraction/sell',
    authenticate,
    requirePolicy('token:sell-fraction'),
    async (req, res) => {
        try {
            const { assetId, amount } = req.body;
            if (!assetId || !amount) {
                return res.status(400).json({
                    success: false,
                    error: 'assetId and amount required',
                });
            }

            req.verifiedUserAddress = await resolveVerifiedUserAddress(req);
            verifyOperationSignature(req, 'token/fraction/sell', [
                ['assetId', assetId],
                ['amount', amount],
            ]);

            const signer = tokenService.getRelayerSigner(req.verifiedUserAddress);
            const result = await tokenService.sellFraction(
                assetId,
                amount,
                req.verifiedUserAddress,
                signer
            );
            res.json({ success: true, data: result });
        } catch (error) {
            logger.error('Fraction sale error:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    }
);

// Create trade order
router.post(
/**
 * @openapi
 * /api/token/trade/create:
 *   post:
 *     tags: [Tokenization]
 *     summary: Create a token trade order
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - assetId
 *               - amount
 *               - price
 *               - orderType
 *               - signature
 *             properties:
 *               assetId:
 *                 type: string
 *               amount:
 *                 type: string
 *               price:
 *                 type: string
 *               orderType:
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
    '/token/trade/create',
    authenticate,
    requirePolicy('token:create-trade'),
    async (req, res) => {
        try {
            const { assetId, amount, price, orderType } = req.body;
            if (!assetId || !amount || !price || !orderType) {
                return res.status(400).json({
                    success: false,
                    error: 'assetId, amount, price, and orderType required',
                });
            }

            req.verifiedUserAddress = await resolveVerifiedUserAddress(req);
            verifyOperationSignature(req, 'token/trade/create', [
                ['assetId', assetId],
                ['amount', amount],
                ['price', price],
                ['orderType', orderType],
            ]);

            const result = await tokenService.createTradeOrder(
                assetId,
                amount,
                price,
                orderType,
                req.verifiedUserAddress
            );
            res.json({ success: true, data: result });
        } catch (error) {
            logger.error('Trade order creation error:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    }
);

// Execute trade order
router.post(
/**
 * @openapi
 * /api/token/trade/execute:
 *   post:
 *     tags: [Tokenization]
 *     summary: Execute a token trade order
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - assetId
 *               - orderIndex
 *               - signature
 *             properties:
 *               assetId:
 *                 type: string
 *               orderIndex:
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
    '/token/trade/execute',
    authenticate,
    requirePolicy('token:execute-trade'),
    async (req, res) => {
        try {
            const { assetId, orderIndex } = req.body;
            if (!assetId || orderIndex === undefined) {
                return res.status(400).json({
                    success: false,
                    error: 'assetId and orderIndex required',
                });
            }

            req.verifiedUserAddress = await resolveVerifiedUserAddress(req);
            verifyOperationSignature(req, 'token/trade/execute', [
                ['assetId', assetId],
                ['orderIndex', orderIndex],
            ]);

            const signer = tokenService.getRelayerSigner(req.verifiedUserAddress);
            const result = await tokenService.executeTradeOrder(
                assetId,
                orderIndex,
                req.verifiedUserAddress,
                signer
            );
            res.json({ success: true, data: result });
        } catch (error) {
            logger.error('Trade order execution error:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    }
);

// Get asset
/**
 * @openapi
 * /api/token/asset/{assetId}:
 *   get:
 *     tags: [Tokenization]
 *     summary: Get tokenized asset details
 *     parameters:
 *       - in: path
 *         name: assetId
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
router.get('/token/asset/:assetId', async (req, res) => {
    try {
        const { assetId } = req.params;
        const asset = await tokenService.getAsset(assetId);
        res.json({ success: true, data: asset });
    } catch (error) {
        logger.error('Asset fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get fractional ownership
/**
 * @openapi
 * /api/token/ownership/{assetId}:
 *   get:
 *     tags: [Tokenization]
 *     summary: Get the authenticated user's asset ownership
 *     parameters:
 *       - in: path
 *         name: assetId
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
router.get('/token/ownership/:assetId', authenticate, async (req, res) => {
    try {
        const { assetId } = req.params;
        const userAddress = await resolveVerifiedUserAddress(req);
        const ownership = await tokenService.getFractionalOwnership(assetId, userAddress);
        res.json({ success: true, data: ownership });
    } catch (error) {
        logger.error('Ownership fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
/**
 * @openapi
 * /api/token/stats:
 *   get:
 *     tags: [Tokenization]
 *     summary: Get tokenization statistics
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get('/token/stats', async (req, res) => {
    try {
        const stats = await tokenService.getStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
