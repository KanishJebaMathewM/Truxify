import express from 'express';
import { verifyTrailerSealIntegrity } from '../services/sealIntegrity.js';

const router = express.Router();

router.post('/verify', (req, res) => {
    try {
        const { ebolId, expectedSerial, sealImageBase64, checkStage, baselineHash } = req.body;

        if (!ebolId || !expectedSerial) {
            return res.status(400).json({ error: 'ebolId and expectedSerial are required.' });
        }

        if (!sealImageBase64) {
            return res.status(400).json({ error: 'sealImageBase64 photo payload is required for computer vision analysis.' });
        }

        const result = verifyTrailerSealIntegrity({
            ebolId,
            expectedSerial,
            sealImageBase64,
            checkStage,
            baselineHash
        });

        if (!result.verificationPassed) {
            return res.status(422).json({
                success: false,
                error: 'SEAL_INTEGRITY_FAILURE',
                message: 'Trailer bolt seal failed integrity check or serial mismatch detected.',
                data: result
            });
        }

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
