import express from 'express';
import {
  getEstimate,
  listPackages,
  buyOffset,
  verifyCertificate,
} from '../controllers/carbonOffsetController.js';

const router = express.Router();

/**
 * GET /api/carbon-offset/estimate
 * Calculates GLEC-compliant carbon emissions for given haul parameters.
 */
router.get('/estimate', getEstimate);

/**
 * GET /api/carbon-offset/packages
 * Lists available certified carbon offset packages.
 */
router.get('/packages', listPackages);

/**
 * POST /api/carbon-offset/purchase
 * Purchases and seals an authenticated offset certificate.
 */
router.post('/purchase', buyOffset);

/**
 * POST /api/carbon-offset/verify
 * Cryptographically validates an issued carbon offset certificate token.
 */
router.post('/verify', verifyCertificate);

export default router;
