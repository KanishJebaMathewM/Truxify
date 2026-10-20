/**
 * @fileoverview Express Router for NHAI Toll Estimator and FASTag Settlement Oracle.
 */

import { Router } from 'express';
import {
  estimateTolls,
  handleFastagWebhook,
  reconcileTrip,
  getOrderTransactions,
  getPlazas,
  optimizeRoutes,
} from '../controllers/tollController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

/**
 * Public Toll Estimation & Plaza Queries
 */
router.get('/plazas', getPlazas);
router.post('/estimate', estimateTolls);
router.post('/optimize', optimizeRoutes);

/**
 * FASTag Webhook Ingestion
 */
router.post('/fastag/webhook', handleFastagWebhook);

/**
 * Authenticated Trip Reconciliation Endpoints
 */
router.post('/reconcile/:orderId', authenticate, reconcileTrip);
router.get('/orders/:orderId/transactions', authenticate, getOrderTransactions);

export default router;
