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
router.get('/token/ownership/:assetId/:userAddress', async (req, res) => {
    try {
        const { assetId, userAddress } = req.params;
        const ownership = await tokenService.getFractionalOwnership(assetId, userAddress);
        res.json({ success: true, data: ownership });
    } catch (error) {
        logger.error('Ownership fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
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
