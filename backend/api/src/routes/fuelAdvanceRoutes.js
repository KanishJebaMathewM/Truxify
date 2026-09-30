/**
 * @fileoverview Express Router for Fuel & Working Capital Micro-Advances.
 */

import { Router } from 'express';
import {
  checkEligibility,
  requestAdvance,
  disburseOnPickup,
  settleEscrow,
  getAdvanceDetails,
} from '../controllers/fuelAdvanceController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/eligibility', authenticate, checkEligibility);
router.post('/request', authenticate, requestAdvance);
router.post('/disburse', authenticate, disburseOnPickup);
router.post('/settle', authenticate, settleEscrow);
router.get('/:bookingId', authenticate, getAdvanceDetails);

export default router;
