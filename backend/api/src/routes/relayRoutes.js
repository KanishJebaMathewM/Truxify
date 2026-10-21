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

/**
 * Public Hub Query & Relay Route Estimation
 */
router.get('/hubs', listHubs);
router.post('/plan', planRelayRoute);

/**
 * Authenticated Relay Management Endpoints
 */
router.post('/create', authenticate, createRelayBooking);
router.post('/handshake/initiate', authenticate, initiateHandoff);
router.post('/handshake/verify', authenticate, verifyHandoff);
router.get('/:relayBookingId', authenticate, getRelayDetails);

export default router;
