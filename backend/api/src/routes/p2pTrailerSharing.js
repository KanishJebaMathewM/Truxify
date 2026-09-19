import express from 'express';
import {
    publishTrailerRepositioningListing,
    findMatchingTrailersForTrip,
    calculateRepositioningYieldPricing,
    bookTrailerWithEscrow,
    getActiveListings
} from '../services/p2pTrailerSharing.js';

const router = express.Router();

// Carrier A posts an empty trailer needing repositioning
router.post('/list-trailer', (req, res) => {
    try {
        const {
            carrierId,
            trailerId,
            trailerType,
            originCity,
            originState,
            destinationCity,
            destinationState,
            dailyRateUSD,
            maxAvailableDays,
            daysIdle,
            demandTier
        } = req.body || {};

        if (!carrierId || !trailerId || !originCity || !destinationCity) {
            return res.status(400).json({
                success: false,
                error: 'carrierId, trailerId, originCity, and destinationCity are required.'
            });
        }

        const listing = publishTrailerRepositioningListing({
            carrierId,
            trailerId,
            trailerType,
            originCity,
            originState,
            destinationCity,
            destinationState,
            dailyRateUSD,
            maxAvailableDays,
            daysIdle,
            demandTier
        });

        return res.status(200).json({
            success: true,
            data: listing
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Carrier B searches for matching repositioning trailers for power-only trips
router.post('/find-matches', (req, res) => {
    try {
        const { seekerCarrierId, originCity, destinationCity, requiredTrailerType } = req.body || {};

        if (!originCity || !destinationCity || !requiredTrailerType) {
            return res.status(400).json({
                success: false,
                error: 'originCity, destinationCity, and requiredTrailerType are required.'
            });
        }

        const matches = findMatchingTrailersForTrip({
            seekerCarrierId,
            originCity,
            destinationCity,
            requiredTrailerType
        });

        return res.status(200).json({
            success: true,
            count: matches.length,
            data: matches
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Books a trailer with security escrow hold
router.post('/book-trailer', (req, res) => {
    try {
        const { listingId, seekerCarrierId, rentalDays, securityDepositUSD } = req.body || {};

        if (!listingId || !seekerCarrierId) {
            return res.status(400).json({
                success: false,
                error: 'listingId and seekerCarrierId are required.'
            });
        }

        const booking = bookTrailerWithEscrow(listingId, seekerCarrierId, rentalDays, { securityDepositUSD });

        return res.status(200).json({
            success: true,
            data: booking
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Calculates dynamic yield pricing for an idle trailer
router.post('/yield-pricing', (req, res) => {
    try {
        const { baseRateUSD, daysIdle, demandTier } = req.body || {};

        const pricing = calculateRepositioningYieldPricing(baseRateUSD, daysIdle, demandTier);

        return res.status(200).json({
            success: true,
            data: pricing
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Returns active marketplace listings
router.get('/active-listings', (req, res) => {
    return res.status(200).json({
        success: true,
        data: getActiveListings()
    });
});

export default router;
