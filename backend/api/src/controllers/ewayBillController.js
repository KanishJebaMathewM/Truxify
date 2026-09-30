/**
 * @fileoverview Express Controller for Indian GST e-Way Bill Compliance & Real-Time Expiry Monitoring.
 */

import {
  registerEwayBill,
  updateEwayVehicle,
  getEwayBill,
} from '../services/ewayBillService.js';
import {
  evaluateEwayExpiryRisk,
} from '../services/ewayExpiryWatcher.js';
import { DomainError } from '../services/order/domainError.js';
import logger from '../middleware/logger.js';

/**
 * Validates and registers an e-Way bill on Polygon.
 */
export async function verifyAndRegister(req, res, next) {
  try {
    const ewayData = req.body;
    const result = await registerEwayBill(ewayData);

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
    logger.error({ error: error.message }, '[ewayBillController.verifyAndRegister] Error');
    next(error);
  }
}

/**
 * Updates Part-B vehicle allocation for transshipment / breakdown.
 */
export async function updateVehicle(req, res, next) {
  try {
    const { ewayBillNumber, newVehicleNumber, reason } = req.body;

    if (!ewayBillNumber || !newVehicleNumber) {
      return res.status(400).json({
        success: false,
        error: 'ewayBillNumber and newVehicleNumber are required',
      });
    }

    const result = await updateEwayVehicle(ewayBillNumber, newVehicleNumber, reason);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
    logger.error({ error: error.message }, '[ewayBillController.updateVehicle] Error');
    next(error);
  }
}

/**
 * Checks predictive expiry risk against live GPS velocity.
 */
export async function checkExpiryRisk(req, res, next) {
  try {
    const tripContext = req.body;
    const evaluation = evaluateEwayExpiryRisk(tripContext);

    return res.status(200).json({
      success: true,
      data: evaluation,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
    logger.error({ error: error.message }, '[ewayBillController.checkExpiryRisk] Error');
    next(error);
  }
}

/**
 * Retrieves compliance records and on-chain verification state.
 */
export async function getEwayDetails(req, res, next) {
  try {
    const { ewayBillNumber } = req.params;
    const record = getEwayBill(ewayBillNumber);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: `e-Way Bill ${ewayBillNumber} not found in compliance registry`,
      });
    }

    return res.status(200).json({
      success: true,
      data: record,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[ewayBillController.getEwayDetails] Error');
    next(error);
  }
}

export default {
  verifyAndRegister,
  updateVehicle,
  checkExpiryRisk,
  getEwayDetails,
};
