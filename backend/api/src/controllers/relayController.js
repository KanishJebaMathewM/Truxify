/**
 * @fileoverview Express Controller for Multi-Leg Relay Hub Dispatch & Cryptographic Hand-offs.
 */

import {
  TRANSSHIPMENT_HUBS,
  partitionRouteIntoCorridorLegs,
  createRelaySession,
  getRelaySession,
  advanceRelayLeg,
} from '../services/relayDispatchService.js';
import {
  generateHandshakeToken,
  verifyRelayHandshake,
} from '../services/relayHandshakeService.js';
import { DomainError } from '../services/order/domainError.js';
import logger from '../middleware/logger.js';

/**
 * Plans corridor segments and hub waypoints for a proposed route.
 */
export async function planRelayRoute(req, res, next) {
  try {
    const { origin, destination, totalAmount, maxLegDistanceKm } = req.body;

    if (!origin || !destination || origin.lat == null || origin.lng == null || destination.lat == null || destination.lng == null) {
      return res.status(400).json({
        success: false,
        error: 'Valid origin and destination coordinates ({lat, lng, address}) are required',
      });
    }

    const plan = partitionRouteIntoCorridorLegs(origin, destination, Number(totalAmount) || 0, {
      maxLegDistanceKm: Number(maxLegDistanceKm) || 350,
    });

    return res.status(200).json({
      success: true,
      data: plan,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[relayController.planRelayRoute] Error');
    next(error);
  }
}

/**
 * Creates and initializes a new relay booking session.
 */
export async function createRelayBooking(req, res, next) {
  try {
    const customerId = req.user?.id || 'cust_anonymous';
    const { origin, destination, totalAmount, driverAssignments } = req.body;

    if (!origin || !destination || !totalAmount) {
      return res.status(400).json({
        success: false,
        error: 'origin, destination, and totalAmount are required to create a relay session',
      });
    }

    const session = await createRelaySession(customerId, {
      origin,
      destination,
      totalAmount: Number(totalAmount),
      driverAssignments,
    });

    return res.status(201).json({
      success: true,
      message: 'Multi-leg relay session created successfully',
      data: session,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[relayController.createRelayBooking] Error');
    next(error);
  }
}

/**
 * Initiates cryptographic hand-off tokens and QR payload for an inbound driver.
 */
export async function initiateHandoff(req, res, next) {
  try {
    const inboundDriverId = req.user?.id || req.body.inboundDriverId;
    const { relayBookingId, legIndex, hubId } = req.body;

    if (!relayBookingId || legIndex == null || !hubId || !inboundDriverId) {
      return res.status(400).json({
        success: false,
        error: 'relayBookingId, legIndex, hubId, and inboundDriverId are required',
      });
    }

    const handshakeToken = generateHandshakeToken(
      relayBookingId,
      Number(legIndex),
      inboundDriverId,
      hubId
    );

    return res.status(200).json({
      success: true,
      message: 'Cryptographic hand-off token generated',
      data: handshakeToken,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[relayController.initiateHandoff] Error');
    next(error);
  }
}

/**
 * Verifies mutual hand-off between transferring and receiving drivers at transit hub.
 */
export async function verifyHandoff(req, res, next) {
  try {
    const verificationData = req.body;
    const { relayBookingId, legIndex } = verificationData;

    if (!relayBookingId || legIndex == null) {
      return res.status(400).json({
        success: false,
        error: 'relayBookingId and legIndex are required for verification',
      });
    }

    // 1. Cryptographically verify mutual signatures, dual OTPs, and geofence
    const handoffReceipt = await verifyRelayHandshake(verificationData);

    // 2. Advance relay session state to the next leg
    const updatedSession = await advanceRelayLeg(relayBookingId, Number(legIndex), handoffReceipt);

    return res.status(200).json({
      success: true,
      message: 'Transshipment custody transfer successfully verified and leg finalized',
      data: {
        receipt: handoffReceipt,
        session: updatedSession,
      },
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status || 400).json({
        success: false,
        error: error.message,
        details: error.details,
      });
    }
    logger.error({ error: error.message }, '[relayController.verifyHandoff] Error');
    next(error);
  }
}

/**
 * Retrieves details of an active relay session.
 */
export async function getRelayDetails(req, res, next) {
  try {
    const { relayBookingId } = req.params;
    const session = await getRelaySession(relayBookingId);

    return res.status(200).json({
      success: true,
      data: session,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status || 404).json({
        success: false,
        error: error.message,
      });
    }
    logger.error({ error: error.message }, '[relayController.getRelayDetails] Error');
    next(error);
  }
}

/**
 * Returns list of registered NHAI national highway transshipment hubs.
 */
export async function listHubs(req, res, next) {
  try {
    return res.status(200).json({
      success: true,
      totalHubs: TRANSSHIPMENT_HUBS.length,
      data: TRANSSHIPMENT_HUBS,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[relayController.listHubs] Error');
    next(error);
  }
}

export default {
  planRelayRoute,
  createRelayBooking,
  initiateHandoff,
  verifyHandoff,
  getRelayDetails,
  listHubs,
};
