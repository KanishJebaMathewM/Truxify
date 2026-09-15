import express from 'express';
import { processGeofencedSignature } from '../services/smartEbol.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/sign', authenticate, userLimiter, (req, res) => {
    try {
        const {
            ebolId,
            receiverId,
            receiverName,
            facilityCoordinates,
            receiverCoordinates,
            signatureData,
            biometricAuthToken
        } = req.body;

        if (!ebolId || !receiverId) {
            return res.status(400).json({ error: 'ebolId and receiverId are required.' });
        }

        if (req.user.role !== 'admin' && receiverId !== req.user.id) {
            return res.status(403).json({ error: 'Access denied. receiverId must match your user ID.' });
        }

        if (!facilityCoordinates || facilityCoordinates.latitude === undefined || facilityCoordinates.longitude === undefined) {
            return res.status(400).json({ error: 'Valid facilityCoordinates (latitude, longitude) are required.' });
        }

        if (!receiverCoordinates || receiverCoordinates.latitude === undefined || receiverCoordinates.longitude === undefined) {
            return res.status(400).json({ error: 'Valid receiverCoordinates (latitude, longitude) are required.' });
        }

        const result = processGeofencedSignature({
            ebolId,
            receiverId,
            receiverName,
            facilityCoordinates,
            receiverCoordinates,
            signatureData,
            biometricAuthToken
        });

        if (!result.signed) {
            return res.status(422).json({
                success: false,
                error: result.reason,
                message: result.message,
                proximityMetrics: result.proximityMetrics
            });
        }

        return res.json({
            success: true,
            data: result.data
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
