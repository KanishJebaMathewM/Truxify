import express from 'express';
import { processGeofencedSignature } from '../services/smartEbol.js';

const router = express.Router();

router.post('/sign', (req, res) => {
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
