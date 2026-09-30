/**
 * @fileoverview Express Controller for Escrow-Backed Fuel & Working Capital Micro-Advances.
 */

import {
  requestFuelAdvance,
  disburseAdvanceOnPickup,
  settleAdvanceEscrow,
  getAdvanceRecord,
} from '../services/fuelAdvanceService.js';
import {
  evaluateDriverCredit,
} from '../services/driverCreditUnderwritingService.js';
import { DomainError } from '../services/order/domainError.js';
import logger from '../middleware/logger.js';

/**
 * Evaluates driver advance eligibility and max funding limit.
 */
export async function checkEligibility(req, res, next) {
  try {
    const driverId = req.user?.id || req.body.driverId;
    const { totalFreightValueInr, completedTrips, averageRating, onTimeRate, disputeCount } = req.body;

    if (!driverId) {
      return res.status(400).json({ success: false, error: 'driverId is required' });
    }

    const evaluation = evaluateDriverCredit({
      driverId,
      totalFreightValueInr: Number(totalFreightValueInr) || 0,
      completedTrips: Number(completedTrips) || 12,
      averageRating: Number(averageRating) || 4.7,
      onTimeRate: Number(onTimeRate) || 0.96,
      disputeCount: Number(disputeCount) || 0,
    });

    return res.status(200).json({
      success: true,
      data: evaluation,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
    logger.error({ error: error.message }, '[fuelAdvanceController.checkEligibility] Error');
    next(error);
  }
}

/**
 * Submits an advance request for an accepted booking.
 */
export async function requestAdvance(req, res, next) {
  try {
    const driverId = req.user?.id || req.body.driverId;
    const { bookingId, totalFreightValueInr, requestedAdvanceInr, payoutRail, driverStats } = req.body;

    const result = await requestFuelAdvance({
      bookingId,
      driverId,
      totalFreightValueInr,
      requestedAdvanceInr,
      payoutRail,
      driverStats,
    });

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
    logger.error({ error: error.message }, '[fuelAdvanceController.requestAdvance] Error');
    next(error);
  }
}

/**
 * Disburses approved advance upon verified pickup.
 */
export async function disburseOnPickup(req, res, next) {
  try {
    const { bookingId, pickupOtp, driverGps, pickupProofDigest } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'bookingId is required' });
    }

    const result = await disburseAdvanceOnPickup(bookingId, {
      pickupOtp,
      driverGps,
      pickupProofDigest,
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
    logger.error({ error: error.message }, '[fuelAdvanceController.disburseOnPickup] Error');
    next(error);
  }
}

/**
 * Settles final freight escrow with atomic advance deduction upon delivery.
 */
export async function settleEscrow(req, res, next) {
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'bookingId is required' });
    }

    const result = await settleAdvanceEscrow(bookingId);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
    logger.error({ error: error.message }, '[fuelAdvanceController.settleEscrow] Error');
    next(error);
  }
}

/**
 * Queries the advance record for a booking.
 */
export async function getAdvanceDetails(req, res, next) {
  try {
    const { bookingId } = req.params;
    const record = getAdvanceRecord(bookingId);

    if (!record) {
      return res.status(404).json({ success: false, error: `Advance record not found for booking ${bookingId}` });
    }

    return res.status(200).json({
      success: true,
      data: record,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[fuelAdvanceController.getAdvanceDetails] Error');
    next(error);
  }
}

export default {
  checkEligibility,
  requestAdvance,
  disburseOnPickup,
  settleEscrow,
  getAdvanceDetails,
};
