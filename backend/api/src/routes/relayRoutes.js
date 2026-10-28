/**
 * @fileoverview Express Router for Multi-Leg Relay Dispatch & Transshipment Orchestration.
 */

import { Router } from 'express';
import {
  planRelayRoute,
  createRelayBooking,
  initiateHandoff,
  verifyHandoff,
  getRelayDetails,
  listHubs,
} from '../controllers/relayController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

function isValidCoordinate(point, latLimit, lngLimit) {
  if (!point || typeof point !== 'object') return false;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= latLimit && Math.abs(lng) <= lngLimit;
}

function validateRelayPlan(req, res, next) {
  const { origin, destination, totalAmount, maxLegDistanceKm } = req.body || {};

  if (!isValidCoordinate(origin, 90, 180) || !isValidCoordinate(destination, 90, 180)) {
    return res.status(400).json({
      success: false,
      error: 'origin and destination must contain valid latitude and longitude values',
    });
  }

  if (totalAmount !== undefined && (!Number.isFinite(Number(totalAmount)) || Number(totalAmount) < 0)) {
    return res.status(400).json({ success: false, error: 'totalAmount must be a non-negative number' });
  }

  if (maxLegDistanceKm !== undefined && (!Number.isFinite(Number(maxLegDistanceKm)) || Number(maxLegDistanceKm) <= 0)) {
    return res.status(400).json({ success: false, error: 'maxLegDistanceKm must be a positive number' });
  }

  return next();
}

/**
 * Public Hub Query & Relay Route Estimation
 */
router.get('/hubs', listHubs);
router.post('/plan', validateRelayPlan, planRelayRoute);

/**
 * Authenticated Relay Management Endpoints
 */
router.post('/create', authenticate, createRelayBooking);
router.post('/handshake/initiate', authenticate, initiateHandoff);
router.post('/handshake/verify', authenticate, verifyHandoff);
router.get('/:relayBookingId', authenticate, getRelayDetails);

export default router;
