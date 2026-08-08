import express from 'express';
import { recordTrailerDrop, locateTrailerInYard } from '../services/ymsTracker.js';

const router = express.Router();

// Record high-precision GPS drop pin for a trailer
router.post('/drop-pin', (req, res) => {
    try {
        const { trailerId, driverId, facilityId, latitude, longitude, yardSlotId, zone } = req.body;

        if (!trailerId || latitude === undefined || longitude === undefined) {
            return res.status(400).json({ error: 'trailerId, latitude, and longitude are required.' });
        }

        const dropRecord = recordTrailerDrop({
            trailerId,
            driverId,
            facilityId,
            latitude,
            longitude,
            yardSlotId,
            zone
        });

        return res.json({
            success: true,
            data: dropRecord
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Locate trailer pin and get micro-navigation / AR guidance
router.post('/locate', (req, res) => {
    try {
        const { trailerId, driverLocation } = req.body;

        if (!trailerId) {
            return res.status(400).json({ error: 'trailerId is required to locate trailer.' });
        }

        const locationDetails = locateTrailerInYard(trailerId, driverLocation);

        if (!locationDetails.found) {
            return res.status(404).json({ success: false, message: locationDetails.message });
        }

        return res.json({
            success: true,
            data: locationDetails
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
