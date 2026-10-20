/**
 * @fileoverview Express Controller for Real-Time IoT Cold-Chain & Cargo Integrity Telemetry.
 */

import {
  registerCargoSLA,
  ingestTelemetryFrame,
  evaluateViaMlService,
  getLoadTelemetryHistory,
} from '../services/iotTelemetryWorker.js';
import {
  enforceSLAPenalty,
  getBookingBreaches,
} from '../services/coldChainEscrowEnforcer.js';
import { DomainError } from '../services/order/domainError.js';
import logger from '../middleware/logger.js';

/**
 * Registers an SLA constraint profile for a perishable freight load.
 */
export async function registerSLA(req, res, next) {
  try {
    const { loadId, bookingId, minTempCelsius, maxTempCelsius, maxExcursionMinutes, maxShockG, penaltyBasisPoints } = req.body;

    if (!loadId) {
      return res.status(400).json({ success: false, error: 'loadId is required' });
    }

    registerCargoSLA(loadId, {
      bookingId,
      minTempCelsius,
      maxTempCelsius,
      maxExcursionMinutes,
      maxShockG,
      penaltyBasisPoints,
    });

    return res.status(201).json({
      success: true,
      message: 'Perishable cargo SLA parameters registered successfully',
      data: {
        loadId,
        minTempCelsius: minTempCelsius || 2.0,
        maxTempCelsius: maxTempCelsius || 8.0,
        maxExcursionMinutes: maxExcursionMinutes || 45,
        maxShockG: maxShockG || 3.5,
      },
    });
  } catch (error) {
    logger.error({ error: error.message }, '[iotColdChainController.registerSLA] Error');
    next(error);
  }
}

/**
 * Ingests a single or batch telemetry frame from BLE beacons / gateways.
 */
export async function ingestTelemetry(req, res, next) {
  try {
    const payload = req.body;

    if (Array.isArray(payload)) {
      const results = [];
      for (const frame of payload) {
        const resSample = await ingestTelemetryFrame(frame);
        results.push(resSample);
      }
      return res.status(200).json({
        success: true,
        batchCount: results.length,
        data: results[results.length - 1], // return latest window summary
      });
    }

    const result = await ingestTelemetryFrame(payload);

    // If critical breach, optionally trigger automated on-chain penalty
    if (result.isCriticalBreach && payload.bookingId) {
      await enforceSLAPenalty({
        bookingId: payload.bookingId,
        breachType: result.slaStatus === 'CRITICAL_BREACH' ? 1 : 2,
        observedValue: result.latestReading.temperature,
        excursionMinutes: result.excursionMinutes,
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
    logger.error({ error: error.message }, '[iotColdChainController.ingestTelemetry] Error');
    next(error);
  }
}

/**
 * Retrieves sliding window telemetry history for an active shipment.
 */
export async function getTelemetryWindow(req, res, next) {
  try {
    const { loadId } = req.params;
    const history = getLoadTelemetryHistory(loadId);

    return res.status(200).json({
      success: true,
      loadId,
      sampleCount: history.length,
      data: history,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[iotColdChainController.getTelemetryWindow] Error');
    next(error);
  }
}

/**
 * Dispatches the current telemetry window to the FastAPI ML worker for deep analysis.
 */
export async function evaluateMl(req, res, next) {
  try {
    const { loadId } = req.params;
    const evaluation = await evaluateViaMlService(loadId);

    return res.status(200).json({
      success: true,
      loadId,
      data: evaluation,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
    logger.error({ error: error.message }, '[iotColdChainController.evaluateMl] Error');
    next(error);
  }
}

/**
 * Retrieves on-chain SLA breach audit trail for a booking.
 */
export async function getBreaches(req, res, next) {
  try {
    const { bookingId } = req.params;
    const breaches = getBookingBreaches(bookingId);

    return res.status(200).json({
      success: true,
      bookingId,
      totalBreaches: breaches.length,
      data: breaches,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[iotColdChainController.getBreaches] Error');
    next(error);
  }
}

export default {
  registerSLA,
  ingestTelemetry,
  getTelemetryWindow,
  evaluateMl,
  getBreaches,
};
