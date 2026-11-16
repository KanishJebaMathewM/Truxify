import express from 'express';
import { getRoute, getDistanceMatrix } from '../controllers/routingController.js';

const router = express.Router();

/**
 * Route handlers for telematics routing and N x M distance matrix.
 */
router.get('/route', getRoute);
router.post('/matrix', getDistanceMatrix);

export default router;
