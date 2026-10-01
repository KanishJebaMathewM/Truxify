import express from 'express';
import {
    verifyTrailerSealIntegrity,
    calculatePerceptualHash,
    calculateHammingDistance,
    ISO_17712_CLASSES
} from '../services/sealIntegrity.js';

const router = express.Router();

/**
 * Validates seal integrity photo and serial number analysis.
 * POST /api/seal-integrity/verify
 */
router.post('/verify', (req, res) => {
    try {
        const {
            ebolId,
            expectedSerial,
            sealImageBase64,
            checkStage,
            baselineHash,
            baselinePerceptualHash,
            detectedSerialOverride,
            sealClass
        } = req.body || {};

        if (!ebolId || !expectedSerial) {
            return res.status(400).json({
                success: false,
                error: 'ebolId and expectedSerial parameters are required.'
            });
        }

        const result = verifyTrailerSealIntegrity({
            ebolId,
            expectedSerial,
            sealImageBase64,
            checkStage,
            baselineHash,
            baselinePerceptualHash,
            detectedSerialOverride,
            sealClass
        });

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Compares two perceptual hashes or image payloads and returns the Hamming distance.
 * POST /api/seal-integrity/compare-hashes
 */
router.post('/compare-hashes', (req, res) => {
    try {
        const { hashA, hashB, imageBase64A, imageBase64B } = req.body || {};

        const pHashA = hashA || (imageBase64A ? calculatePerceptualHash(imageBase64A) : null);
        const pHashB = hashB || (imageBase64B ? calculatePerceptualHash(imageBase64B) : null);

        if (!pHashA || !pHashB) {
            return res.status(400).json({
                success: false,
                error: 'Either hashA/hashB or imageBase64A/imageBase64B must be provided.'
            });
        }

        const distance = calculateHammingDistance(pHashA, pHashB);
        const isMatch = distance <= 10;

        return res.status(200).json({
            success: true,
            data: {
                hashA: pHashA,
                hashB: pHashB,
                hammingDistance: distance,
                maxAllowedDistance: 10,
                isVisualMatch: isMatch,
                tamperWarning: !isMatch
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Returns ISO 17712 security seal classification specifications.
 * GET /api/seal-integrity/iso-standards
 */
router.get('/iso-standards', (req, res) => {
    return res.status(200).json({
        success: true,
        data: ISO_17712_CLASSES
    });
});

export default router;
