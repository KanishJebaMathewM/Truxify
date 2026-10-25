/**
 * @fileoverview Express Router for CRDT Offline State Synchronization.
 */

import { Router } from 'express';
import {
  pushMutations,
  pullDeltas,
  reconcile,
  getEntity,
} from '../controllers/crdtSyncController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/push', authenticate, pushMutations);
router.get('/pull', authenticate, pullDeltas);
router.post('/reconcile', authenticate, reconcile);
router.get('/entity/:entityType/:entityId', authenticate, getEntity);

export default router;
