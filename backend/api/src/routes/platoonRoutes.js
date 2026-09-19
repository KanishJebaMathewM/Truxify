import express from 'express';
import {
  findPartners,
  createSession,
  updateTelemetry,
  emergencyDecouple,
  disengage,
} from '../controllers/platoonController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/partners', authenticateToken, findPartners);
router.post('/sessions', authenticateToken, createSession);
router.post('/sessions/:platoonId/telemetry', authenticateToken, updateTelemetry);
router.post('/sessions/:platoonId/emergency-decouple', authenticateToken, emergencyDecouple);
router.post('/sessions/:platoonId/disengage', authenticateToken, disengage);

export default router;
