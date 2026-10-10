/**
 * @openapi
 * components:
 *   schemas:
 *     Truck:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *         number_plate:
 *           type: string
 *         max_capacity_tons:
 *           type: number
 *         created_at:
 *           type: string
 *           format: date-time
 *     TruckTypesResponse:
 *       type: object
 *       properties:
 *         types:
 *           type: array
 *           items:
 *             type: string
 *     RegisterTruckRequest:
 *       type: object
 *       required:
 *         - name
 *         - number_plate
 *         - max_capacity_tons
 *       properties:
 *         name:
 *           type: string
 *         number_plate:
 *           type: string
 *         max_capacity_tons:
 *           type: number
 *     TruckListResponse:
 *       type: object
 *       properties:
 *         trucks:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Truck'
 *     TruckSearchResult:
 *       type: object
 *       properties:
 *         driver:
 *           type: string
 *         driverId:
 *           type: string
 *         rating:
 *           type: number
 *         truck:
 *           type: string
 *         truckNumber:
 *           type: string
 *         capacity:
 *           type: string
 *         price:
 *           type: number
 *         baseFreight:
 *           type: number
 *         tollEstimate:
 *           type: number
 *         platformFee:
 *           type: number
 *         isAiEstimate:
 *           type: boolean
 *         etaMinutes:
 *           type: number
 *           nullable: true
 *     TruckNumberPlateResponse:
 *       type: object
 *       properties:
 *         number_plate:
 *           type: string
 */

import express from 'express';
import crypto from 'crypto';
import {
  supabase,
  supabaseAdmin,
  createUserClient,
  mongoDb,
  redisClient
} from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateParams, validateBody } from '../middleware/validate.js';
import {
  uuidParamSchema,
  registerTruckSchema
} from '../validation/requestSchemas.js';
import { getRouteEstimate } from '../services/osrm.js';
import { computeOrderPricing } from '../lib/pricing.js';
import { predictPrice } from '../services/ml.js';
import { getLiveTrafficMultiplier } from '../services/trafficService.js';
import { escapeLike } from '../lib/escapeLike.js';
import { cacheMiddleware } from '../middleware/cacheMiddleware.js';
import { getTruckSearchVersion } from '../utils/cacheInvalidation.js';
import logger from '../middleware/logger.js';
import { FuelAdvisorService } from '../services/fuelAdvisorService.js';
import { WeatherService } from '../services/weatherService.js';
import { validateCoordinate } from '../utils/coordinates.js';

const weatherService = new WeatherService({ logger });
const fuelAdvisorService = new FuelAdvisorService({
  supabase,
  weatherService,
  logger
});

const DEFAULT_TRUCK_TYPES = [
  'Open Body',
  'Closed Body',
  'Container',
  'Refrigerated'
];

function sanitizeNumberPlate(plate) {
  if (!plate || typeof plate !== 'string') return '';
  return plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sanitizeTruckName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().slice(0, 100)
    .replace(/[<>]/g, '')
    .replace(/script/gi, '')
    .replace(/javascript/gi, '')
    .replace(/on\w+=/gi, '');
}

const router = express.Router();

/**
 * @openapi
 * /api/trucks/types:
 *   get:
 *     tags: [Trucks]
 *     summary: List available truck types
 *     description: Returns the list of supported truck types for load matching.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Truck types array
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TruckTypesResponse'
 */
router.get('/types', authenticate, userLimiter, (req, res) => {
  return res.json({
    types: DEFAULT_TRUCK_TYPES
  });
});

function parseCapacityFilter(value, field) {
  if (value === undefined) return { value: undefined };

  if (typeof value !== 'string' || value.trim().length === 0) {
    return { error: `${field} must be a non-negative number` };
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { error: `${field} must be a non-negative number` };
  }

  return { value: parsed };
}

// ============================================================================
// REGISTER A TRUCK (DRIVER ONLY)
// ============================================================================

/**
 * @openapi
 * /api/trucks:
 *   post:
 *     tags: [Trucks]
 *     summary: Register a truck
 *     description: Allows authenticated drivers to register a truck they own. Number plate is normalised to uppercase.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterTruckRequest'
 *     responses:
 *       201:
 *         description: Truck registered
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden for non-drivers
 *       409:
 *         description: Number plate already registered
 */
router.post(
  '/',
  authenticate,
  requirePolicy('truck:register'),
  userLimiter,
  validateBody(registerTruckSchema),
  async (req, res) => {
    const { name, truck_type, number_plate, max_capacity_tons } = req.body;
    const normalizedNumberPlate = sanitizeNumberPlate(number_plate);

    try {
      const userDb = createUserClient(req.token);

      const { data: existing, error: checkErr } = await userDb
        .from('trucks')
        .select('id')
        .eq('number_plate', normalizedNumberPlate)
        .maybeSingle();

      if (checkErr) {
        return res.status(500).json({
          error: 'Failed to check for existing truck.',
          details: checkErr.message
        });
      }

      if (existing) {
        return res.status(409).json({
          error: 'A truck with this number plate is already registered.'
        });
      }

      const { data: truck, error: insertErr } = await userDb
        .from('trucks')
        .insert({
          name: sanitizeTruckName(name),
          truck_type,
          number_plate: normalizedNumberPlate,
          max_capacity_tons,
          driver_id: req.user.id
        })
        .select('id, name, truck_type, number_plate, max_capacity_tons, created_at')
        .single();

      if (insertErr) {
        return res.status(500).json({
          error: 'Failed to register truck.',
          details: insertErr.message
        });
      }

      return res.status(201).json({
        message: 'Truck registered successfully.',
        truck
      });
    } catch (err) {
      logger.error(
        { err: err.message },
        'Truck registration error'
      );
      return res.status(500).json({
        error: 'Internal Server Error'
      });
    }
  }
);
