/**
 * @fileoverview Express Router for Indian GST e-Way Bill Compliance Gateway.
 */

import { Router } from 'express';
import {
  verifyAndRegister,
  updateVehicle,
  checkExpiryRisk,
  getEwayDetails,
} from '../controllers/ewayBillController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

/**
 * Public/Driver Telemetry Expiry Check
 */
router.post('/expiry-check', checkExpiryRisk);
router.get('/:ewayBillNumber', getEwayDetails);

/**
 * Authenticated Consignment Compliance Endpoints
 */
router.post('/verify', authenticate, verifyAndRegister);
router.post('/vehicle/update', authenticate, updateVehicle);

export default router;
