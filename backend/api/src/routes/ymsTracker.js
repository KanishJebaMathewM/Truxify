import express from 'express';
import {
    recordTrailerDrop,
    locateTrailerInYard,
    registerYardSlot,
    listYardSlots,
    allocateYardSlot,
    releaseYardSlot,
    evaluateDwellDemurrage,
    generateDemurrageInvoice
} from '../services/ymsTracker.js';

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

// Register or update yard slot in facility
router.post('/slots/register', (req, res) => {
    try {
        const { facilityId, slotData } = req.body;
        if (!facilityId || !slotData) {
            return res.status(400).json({ error: 'facilityId and slotData are required.' });
        }
        const registered = registerYardSlot(facilityId, slotData);
        return res.status(201).json({ success: true, data: registered });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// List slots in facility with optional filters
router.get('/slots/:facilityId', (req, res) => {
    try {
        const { facilityId } = req.params;
        const filters = {
            status: req.query.status,
            slotType: req.query.slotType,
            hasReeferPlug: req.query.hasReeferPlug !== undefined ? req.query.hasReeferPlug === 'true' : undefined,
            isHazmatApproved: req.query.isHazmatApproved !== undefined ? req.query.isHazmatApproved === 'true' : undefined
        };
        const slots = listYardSlots(facilityId, filters);
        return res.json({ success: true, count: slots.length, data: slots });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Allocate optimal slot for trailer
router.post('/slots/allocate', (req, res) => {
    try {
        const { facilityId, trailerRequirements } = req.body;
        if (!facilityId || !trailerRequirements) {
            return res.status(400).json({ error: 'facilityId and trailerRequirements are required.' });
        }
        const result = allocateYardSlot(facilityId, trailerRequirements);
        if (!result.allocated) {
            return res.status(409).json({ success: false, data: result });
        }
        return res.json({ success: true, data: result });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Release yard slot on checkout
router.post('/slots/release', (req, res) => {
    try {
        const { facilityId, slotId } = req.body;
        if (!facilityId || !slotId) {
            return res.status(400).json({ error: 'facilityId and slotId are required.' });
        }
        const result = releaseYardSlot(facilityId, slotId);
        return res.json({ success: true, data: result });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Evaluate dwell time & demurrage fees for trailer
router.post('/dwell/evaluate', (req, res) => {
    try {
        const { trailerId, evaluationTimestamp, customPolicy } = req.body;
        if (!trailerId) {
            return res.status(400).json({ error: 'trailerId is required.' });
        }
        const evaluation = evaluateDwellDemurrage(trailerId, evaluationTimestamp, customPolicy);
        return res.json({ success: true, data: evaluation });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Generate sealed demurrage settlement invoice
router.post('/dwell/invoice', (req, res) => {
    try {
        const { trailerId, carrierInfo, checkoutTimestamp } = req.body;
        if (!trailerId) {
            return res.status(400).json({ error: 'trailerId is required.' });
        }
        const invoice = generateDemurrageInvoice(trailerId, carrierInfo, checkoutTimestamp);
        return res.json({ success: true, data: invoice });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
