import express from 'express';
import { matchLtlPartialLoads } from '../services/ltlConsolidation.js';

const router = express.Router();

router.post('/match', (req, res) => {
    try {
        const { truck, partialLoads } = req.body;

        if (!truck || !truck.id) {
            return res.status(400).json({ error: 'Valid truck payload with remaining capacity parameters is required.' });
        }

        if (!partialLoads || !Array.isArray(partialLoads)) {
            return res.status(400).json({ error: 'Array of candidate partial spot loads is required.' });
        }

        const matchResults = matchLtlPartialLoads(truck, partialLoads);

        return res.json({
            success: true,
            data: matchResults
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
