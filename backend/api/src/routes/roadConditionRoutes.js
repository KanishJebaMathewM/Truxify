import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { reportGripData, getNearbyGripData } from '../controllers/roadConditionController.js';
import rateLimit from 'express-rate-limit';
import { safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';

const router = express.Router();

const roadConditionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // allow more frequent telemetry updates
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  store: createStore('rl:road-conditions:'),
});

/**
 * @swagger
 * /api/road-conditions/grip:
 *   post:
 *     summary: Report road grip telemetry
 *     description: Records a grip index and micro-slip event count for the authenticated user.
 *     tags: [Road Conditions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RoadGripReport'
 *     responses:
 *       201:
 *         description: Grip telemetry recorded successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RoadGripReportCreated'
 *       400:
 *         description: Invalid telemetry payload.
 *       401:
 *         description: Authentication required.
 *       500:
 *         description: Failed to persist telemetry.
 */
router.post('/grip', roadConditionLimiter, authenticate, reportGripData);

/**
 * @swagger
 * /api/road-conditions/grip/nearby:
 *   get:
 *     summary: Retrieve nearby road grip telemetry
 *     description: Returns road grip reports from the last 12 hours within the requested radius.
 *     tags: [Road Conditions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         description: Latitude of the search center.
 *         schema:
 *           type: number
 *           minimum: -90
 *           maximum: 90
 *       - in: query
 *         name: lng
 *         required: true
 *         description: Longitude of the search center.
 *         schema:
 *           type: number
 *           minimum: -180
 *           maximum: 180
 *       - in: query
 *         name: radius_miles
 *         required: false
 *         description: Search radius in miles. Defaults to 50 and must not exceed 1000.
 *         schema:
 *           type: number
 *           exclusiveMinimum: 0
 *           maximum: 1000
 *           default: 50
 *     responses:
 *       200:
 *         description: Nearby grip reports.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NearbyGripReportResponse'
 *       400:
 *         description: Invalid or missing coordinates/radius.
 *       401:
 *         description: Authentication required.
 *       500:
 *         description: Failed to retrieve telemetry.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     RoadGripReport:
 *       type: object
 *       required: [latitude, longitude, grip_index, slip_events_count]
 *       properties:
 *         latitude:
 *           type: number
 *           minimum: -90
 *           maximum: 90
 *         longitude:
 *           type: number
 *           minimum: -180
 *           maximum: 180
 *         grip_index:
 *           type: number
 *           description: Grip index reported by the vehicle sensor.
 *         slip_events_count:
 *           type: integer
 *           minimum: 0
 *           description: Number of micro-slip events recorded by the vehicle sensor.
 *     RoadGripReportCreated:
 *       type: object
 *       required: [success, message]
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Grip data reported successfully
 *     NearbyGripReportResponse:
 *       type: object
 *       required: [success, data]
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/RoadGripReportRecord'
 *     RoadGripReportRecord:
 *       allOf:
 *         - $ref: '#/components/schemas/RoadGripReport'
 *         - type: object
 *           required: [id, recorded_at]
 *           properties:
 *             id:
 *               type: string
 *             recorded_at:
 *               type: string
 *               format: date-time
 */
router.get('/grip/nearby', roadConditionLimiter, authenticate, getNearbyGripData);

export default router;
