/**
 * @fileoverview Express Router for Real-Time IoT Cold-Chain & Cargo Integrity Telemetry.
 */

import { Router } from 'express';
import {
  registerSLA,
  ingestTelemetry,
  getTelemetryWindow,
  evaluateMl,
  getBreaches,
} from '../controllers/iotColdChainController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

/**
 * Public & Gateway Sensor Ingestion
 */
router.post('/telemetry', ingestTelemetry);
router.get('/:loadId/window', getTelemetryWindow);
router.post('/:loadId/evaluate-ml', evaluateMl);

/**
 * Authenticated SLA Management Endpoints
 */
router.post('/sla', authenticate, registerSLA);
router.get('/:bookingId/breaches', authenticate, getBreaches);

export default router;
