/**
 * @fileoverview Express Controller for NHAI Toll Estimation and FASTag Webhook Reconciliation.
 */

import {
  VEHICLE_AXLE_CLASSES,
  estimateRouteTolls,
  listAllPlazas,
} from '../services/tollService.js';
import {
  verifyFastagWebhookSignature,
  processFastagTransaction,
  reconcileOrderTolls,
  getOrderTollTransactions,
} from '../services/fastagReconciliationService.js';
import { optimizeTollRoutes } from '../services/tollOptimization.js';
import { DomainError } from '../services/order/domainError.js';
import logger from '../middleware/logger.js';

/**
 * Estimates toll costs along a route for a specified vehicle axle class.
 */
export async function estimateTolls(req, res, next) {
  try {
    const { origin, destination, vehicleClass, waypoints } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({
        success: false,
        error: 'Origin and destination coordinates ({lat, lng}) are required',
      });
    }

    const tollEstimate = estimateRouteTolls(origin, destination, vehicleClass, waypoints);

    return res.status(200).json({
      success: true,
      data: tollEstimate,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[tollController.estimateTolls] Error');
    next(error);
  }
}

/**
 * Ingests incoming NETC / NPCI FASTag webhook transactions.
 */
export async function handleFastagWebhook(req, res, next) {
  try {
    const signatureHeader = req.headers['x-fastag-signature'] || req.headers['x-webhook-signature'];
    const payload = req.body;

    // Verify HMAC if signature is present in production
    if (process.env.NODE_ENV === 'production' && signatureHeader) {
      const isValid = verifyFastagWebhookSignature(req.rawBody || payload, signatureHeader);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid FASTag webhook HMAC signature',
        });
      }
    }

    const { transaction, gpsContext } = payload;
    const txData = transaction || payload;

    const result = await processFastagTransaction(txData, gpsContext);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status || 400).json({
        success: false,
        error: error.message,
      });
    }
    logger.error({ error: error.message }, '[tollController.handleFastagWebhook] Error');
    next(error);
  }
}

/**
 * Reconciles trip tolls for an order against initial estimates.
 */
export async function reconcileTrip(req, res, next) {
  try {
    const { orderId } = req.params;
    const { estimatedTollInr } = req.body;

    const reconciliation = await reconcileOrderTolls(orderId, Number(estimatedTollInr) || 0);

    return res.status(200).json({
      success: true,
      data: reconciliation,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[tollController.reconcileTrip] Error');
    next(error);
  }
}

/**
 * Retrieves all reconciled FASTag transactions for an order.
 */
export async function getOrderTransactions(req, res, next) {
  try {
    const { orderId } = req.params;
    const transactions = getOrderTollTransactions(orderId);

    return res.status(200).json({
      success: true,
      orderId,
      totalTransactions: transactions.length,
      data: transactions,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[tollController.getOrderTransactions] Error');
    next(error);
  }
}

/**
 * Lists registered NHAI toll plazas with optional highway filter.
 */
export async function getPlazas(req, res, next) {
  try {
    const { highway } = req.query;
    const plazas = listAllPlazas(highway);

    return res.status(200).json({
      success: true,
      vehicleClasses: VEHICLE_AXLE_CLASSES,
      totalPlazas: plazas.length,
      data: plazas,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[tollController.getPlazas] Error');
    next(error);
  }
}

/**
 * Preserves backwards compatibility for route operational cost optimization.
 */
export async function optimizeRoutes(req, res, next) {
  try {
    const { routes, loadDetails } = req.body;

    if (!routes || !Array.isArray(routes) || routes.length === 0) {
      return res.status(400).json({ success: false, error: 'Array of candidate routes is required.' });
    }

    const result = optimizeTollRoutes(routes, loadDetails);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default {
  estimateTolls,
  handleFastagWebhook,
  reconcileTrip,
  getOrderTransactions,
  getPlazas,
  optimizeRoutes,
};
