/**
 * Cross-docking synchronization engine routes (#6181).
 *
 * Mounts the handoff lifecycle:
 *   GET    /cross-dock/candidates?orderId=&cross_dock_lat=&cross_dock_lng=&radius_km=
 *   POST   /cross-dock                        create a transfer request
 *   GET    /cross-dock                         list transfers for the driver
 *   GET    /cross-dock/:id                     view a transfer (participants only)
 *   POST   /cross-dock/:id/accept              to_driver accepts
 *   POST   /cross-dock/:id/decline             to_driver declines
 *   POST   /cross-dock/:id/cancel              from_driver cancels
 *   POST   /cross-dock/:id/verify              to_driver verifies handoff (OTP)
 *
 * Authorization: every route requires authentication + a `crossdock:*` policy.
 * Participant-level ownership is enforced inside the service.
 */

import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  crossDockParamSchema,
  crossDockCandidateSchema,
  createCrossDockSchema,
  verifyHandoffSchema,
  uuidSchema,
} from '../validation/requestSchemas.js';
import logger from '../middleware/logger.js';
import { DomainError } from '../services/order/domainError.js';
import {
  findHandoffCandidates,
  createTransferRequest,
  acceptTransferRequest,
  declineTransferRequest,
  cancelTransferRequest,
  verifyHandoff,
  getTransfer,
  listTransfers,
} from '../services/order/crossDockService.js';

const router = express.Router();

function handleError(res, err, label) {
  if (err instanceof DomainError) {
    return res.status(err.status).json(err.payload);
  }
  logger.error(`[cross-dock] ${label} exception:`, err.message);
  return res.status(500).json({ error: 'Internal Server Error' });
}

// GET /cross-dock/candidates — find drivers near a cross-dock point for a load.
router.get(
  '/candidates',
  authenticate,
  requireRole(['driver', 'admin']),
  requirePolicy('crossdock:list-candidates'),
  async (req, res) => {
    try {
      const orderId = req.query.orderId;
      if (!orderId || !uuidSchema.safeParse(orderId).success) {
        return res.status(400).json({ error: 'Valid orderId query param is required.' });
      }
      const parsed = crossDockCandidateSchema.safeParse({
        cross_dock_lat: req.query.cross_dock_lat,
        cross_dock_lng: req.query.cross_dock_lng,
        radius_km: req.query.radius_km,
        limit: req.query.limit,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid candidate query', details: parsed.error.issues });
      }
      const candidates = await findHandoffCandidates({
        orderId,
        crossDockLat: parsed.data.cross_dock_lat,
        crossDockLng: parsed.data.cross_dock_lng,
        fromDriverId: req.user.id,
        radiusKm: parsed.data.radius_km,
        limit: parsed.data.limit,
      });
      return res.json({ candidates });
    } catch (err) {
      return handleError(res, err, 'candidates');
    }
  }
);

// POST /cross-dock — create a transfer request (returns one-time handoff code).
router.post(
  '/',
  authenticate,
  requireRole(['driver']),
  requirePolicy('crossdock:create'),
  validateBody(createCrossDockSchema),
  async (req, res) => {
    try {
      // orderId comes from the query string so the body stays reusable.
      const orderId = req.query.orderId;
      if (!orderId || !uuidSchema.safeParse(orderId).success) {
        return res.status(400).json({ error: 'Valid orderId query param is required.' });
      }
      const transfer = await createTransferRequest({
        orderId,
        fromDriverId: req.user.id,
        toDriverId: req.body.to_driver_id,
        crossDockLat: req.body.cross_dock_lat,
        crossDockLng: req.body.cross_dock_lng,
        crossDockNote: req.body.cross_dock_note,
      });
      return res.status(201).json(transfer);
    } catch (err) {
      return handleError(res, err, 'create');
    }
  }
);

// GET /cross-dock — list transfers for the authenticated driver.
router.get(
  '/',
  authenticate,
  requireRole(['driver', 'admin']),
  requirePolicy('crossdock:list'),
  async (req, res) => {
    try {
      const status = req.query.status;
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
      const transfers = await listTransfers({ driverId: req.user.id, status, limit });
      return res.json({ transfers });
    } catch (err) {
      return handleError(res, err, 'list');
    }
  }
);

// GET /cross-dock/:id — view a transfer (participants only).
router.get(
  '/:id',
  authenticate,
  requireRole(['driver', 'admin']),
  requirePolicy('crossdock:view'),
  validateParams(crossDockParamSchema),
  async (req, res) => {
    try {
      const transfer = await getTransfer({ transferId: req.params.id, driverId: req.user.id });
      // Strip the OTP hash from the API surface; it is a server secret.
      const { otp_hash, otp_attempts, otp_expires_at, ...safe } = transfer;
      return res.json({ transfer: safe });
    } catch (err) {
      return handleError(res, err, 'view');
    }
  }
);

// POST /cross-dock/:id/accept — to_driver accepts.
router.post(
  '/:id/accept',
  authenticate,
  requireRole(['driver']),
  requirePolicy('crossdock:accept'),
  validateParams(crossDockParamSchema),
  async (req, res) => {
    try {
      const transfer = await acceptTransferRequest({ transferId: req.params.id, driverId: req.user.id });
      return res.json(transfer);
    } catch (err) {
      return handleError(res, err, 'accept');
    }
  }
);

// POST /cross-dock/:id/decline — to_driver declines.
router.post(
  '/:id/decline',
  authenticate,
  requireRole(['driver']),
  requirePolicy('crossdock:decline'),
  validateParams(crossDockParamSchema),
  async (req, res) => {
    try {
      const transfer = await declineTransferRequest({ transferId: req.params.id, driverId: req.user.id });
      return res.json(transfer);
    } catch (err) {
      return handleError(res, err, 'decline');
    }
  }
);

// POST /cross-dock/:id/cancel — from_driver cancels.
router.post(
  '/:id/cancel',
  authenticate,
  requireRole(['driver']),
  requirePolicy('crossdock:cancel'),
  validateParams(crossDockParamSchema),
  async (req, res) => {
    try {
      const transfer = await cancelTransferRequest({ transferId: req.params.id, driverId: req.user.id });
      return res.json(transfer);
    } catch (err) {
      return handleError(res, err, 'cancel');
    }
  }
);

// POST /cross-dock/:id/verify — to_driver verifies handoff code.
router.post(
  '/:id/verify',
  authenticate,
  requireRole(['driver']),
  requirePolicy('crossdock:verify'),
  validateParams(crossDockParamSchema),
  validateBody(verifyHandoffSchema),
  async (req, res) => {
    try {
      const transfer = await verifyHandoff({
        transferId: req.params.id,
        driverId: req.user.id,
        handoffCode: req.body.handoff_code,
      });
      return res.json(transfer);
    } catch (err) {
      return handleError(res, err, 'verify');
    }
  }
);

export default router;
