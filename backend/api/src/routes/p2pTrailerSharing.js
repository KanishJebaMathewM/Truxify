import express from 'express';
import {
    publishTrailerRepositioningListing,
    findMatchingTrailersForTrip
} from '../services/p2pTrailerSharing.js';

const router = express.Router();

// Carrier A posts an empty trailer needing repositioning
router.post('/list-trailer', (req, res) => {
    try {
        const { carrierId, trailerId, trailerType, originCity, originState, destinationCity, destinationState, dailyRateUSD } = req.body;

        if (!carrierId || !trailerId || !originCity || !destinationCity) {
            return res.status(400).json({ error: 'carrierId, trailerId, originCity, and destinationCity are required.' });
        }

        const listing = publishTrailerRepositioningListing({
            carrierId,
            trailerId,
            trailerType,
            originCity,
            originState,
            destinationCity,
            destinationState,
            dailyRateUSD
        });

        return res.json({
            success: true,
            data: listing
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Carrier B searches for matching repositioning trailers for power-only trips
router.post('/find-matches', (req, res) => {
    try {
        const { seekerCarrierId, originCity, destinationCity, requiredTrailerType } = req.body;

        if (!originCity || !destinationCity || !requiredTrailerType) {
            return res.status(400).json({ error: 'originCity, destinationCity, and requiredTrailerType are required.' });
        }

        const matches = findMatchingTrailersForTrip({
            seekerCarrierId,
            originCity,
            destinationCity,
            requiredTrailerType
        });

        return res.json({
            success: true,
            count: matches.length,
            data: matches
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
