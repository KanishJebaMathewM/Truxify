import express from 'express';
import {
    generateOtaTuningPayload,
    verifyOtaTuningPayload,
    packageIntoJ1939CanFrames,
    ECM_PROFILES,
    J1939_PGNS
} from '../services/ecmTuning.js';

const router = express.Router();

/**
 * Generates an Over-The-Air (OTA) tuning payload.
 * POST /api/ecm/tune-ota
 */
router.post('/tune-ota', (req, res) => {
    try {
        const { truckId, vin, topologyData } = req.body || {};

        if (!truckId || !topologyData) {
            return res.status(400).json({
                success: false,
                error: 'truckId and topologyData parameters are required.'
            });
        }

        const otaPayload = generateOtaTuningPayload({
            truckId,
            vin,
            topologyData
        });

        return res.status(200).json({
            success: true,
            data: otaPayload
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Packages an OTA tuning payload into a sequence of SAE J1939 8-byte CAN-bus frames.
 * POST /api/ecm/j1939-frames
 */
router.post('/j1939-frames', (req, res) => {
    try {
        const { truckId, vin, topologyData } = req.body || {};

        if (!truckId) {
            return res.status(400).json({
                success: false,
                error: 'truckId is required.'
            });
        }

        const otaPayload = generateOtaTuningPayload({ truckId, vin, topologyData });
        const canStream = packageIntoJ1939CanFrames(otaPayload);

        return res.status(200).json({
            success: true,
            data: canStream
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Verifies authenticity of an inbound OTA tuning packet.
 * POST /api/ecm/verify-ota
 */
router.post('/verify-ota', (req, res) => {
    try {
        const { otaPackage, signature } = req.body || {};

        const verification = verifyOtaTuningPayload(otaPackage, signature);

        return res.status(200).json({
            success: true,
            ...verification
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Returns available ECM tuning profiles and J1939 parameter definitions.
 * GET /api/ecm/profiles
 */
router.get('/profiles', (req, res) => {
    return res.status(200).json({
        success: true,
        data: {
            profiles: ECM_PROFILES,
            j1939Pgns: J1939_PGNS
        }
    });
});

export default router;
