/**
 * @fileoverview Express Controller for CRDT State Synchronization & Offline Reconciliations.
 */

import {
  mergeClientMutations,
  getDeltasSince,
  getEntityState,
  generateServerHlc,
} from '../services/crdtSyncService.js';
import { DomainError } from '../services/order/domainError.js';
import logger from '../middleware/logger.js';

/**
 * Ingests and merges offline client mutation batch.
 */
export async function pushMutations(req, res, next) {
  try {
    const { mutations, clientClock } = req.body;

    if (!mutations || !Array.isArray(mutations)) {
      return res.status(400).json({ success: false, error: 'mutations array is required' });
    }

    const mergeResult = await mergeClientMutations(mutations, clientClock);

    return res.status(200).json({
      success: true,
      message: `Processed ${mutations.length} mutations`,
      data: mergeResult,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[crdtSyncController.pushMutations] Error');
    next(error);
  }
}

/**
 * Pulls server-side deltas since client's last synchronized HLC.
 */
export async function pullDeltas(req, res, next) {
  try {
    const { sinceHlc, entityType } = req.query;
    const deltas = getDeltasSince(sinceHlc, entityType);
    const serverClock = generateServerHlc(sinceHlc);

    return res.status(200).json({
      success: true,
      serverClock,
      deltaCount: deltas.length,
      data: deltas,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[crdtSyncController.pullDeltas] Error');
    next(error);
  }
}

/**
 * Performs full bi-directional state reconciliation (Push client deltas + Pull server deltas).
 */
export async function reconcile(req, res, next) {
  try {
    const { mutations = [], clientClock, entityType } = req.body;

    // 1. Push incoming client mutations
    const mergeResult = await mergeClientMutations(mutations, clientClock);

    // 2. Fetch server updates since client clock
    const serverDeltas = getDeltasSince(clientClock, entityType);

    return res.status(200).json({
      success: true,
      message: 'Bi-directional state reconciliation completed',
      data: {
        pushResult: mergeResult,
        serverDeltas,
        serverClock: mergeResult.serverClock,
      },
    });
  } catch (error) {
    logger.error({ error: error.message }, '[crdtSyncController.reconcile] Error');
    next(error);
  }
}

/**
 * Queries the resolved state for a specific entity.
 */
export async function getEntity(req, res, next) {
  try {
    const { entityType, entityId } = req.params;
    const state = getEntityState(entityType, entityId);

    return res.status(200).json({
      success: true,
      entityType,
      entityId,
      data: state,
    });
  } catch (error) {
    logger.error({ error: error.message }, '[crdtSyncController.getEntity] Error');
    next(error);
  }
}

export default {
  pushMutations,
  pullDeltas,
  reconcile,
  getEntity,
};
