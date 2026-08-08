import express from 'express';
import { evaluateBypassEligibility, createSignedWimPacket } from '../services/wimBypass.js';

const router = express.Router();

router.post('/request-bypass', (req, res) => {
    try {
        const { truckId, safetyScore, bolId, axleWeight, maxWeightLimit } = req.body;

        if (!truckId || !bolId || axleWeight === undefined || safetyScore === undefined) {
            return res.status(400).json({ error: 'Missing required truck/load parameters' });
        }

        const isEligible = evaluateBypassEligibility({
            safetyScore,
            axleWeight,
            maxWeightLimit: maxWeightLimit || 80000,
        });

        if (!isEligible) {
            return res.json({
                signal: 'PULL_IN',
                message: 'Truck must pull into weigh station.',
            });
        }

        const signedPacket = createSignedWimPacket({
            truckId,
            safetyScore,
            bolId,
            axleWeight,
        });

        return res.json({
            signal: 'BYPASS',
            message: 'Green signal: Cleared to bypass weigh station.',
            wimPacket: signedPacket,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
