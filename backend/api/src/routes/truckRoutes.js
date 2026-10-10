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

import crypto from 'node:crypto';
import express from 'express';
import {
  supabase,
  supabaseAdmin,
  mongoDb,
  redisClient
} from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import {
  validateParams,
  validateBody
} from '../middleware/validate.js';
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

  return plate
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function sanitizeTruckName(name) {
  if (!name || typeof name !== 'string') return '';

  return name.trim()
    .slice(0, 100)
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
  if (value === undefined) {
    return { value: undefined };
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return {
      error: `${field} must be a non-negative number`
    };
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      error: `${field} must be a non-negative number`
    };
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 truck:
 *                   $ref: '#/components/schemas/Truck'
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
    const {
      name,
      truck_type,
      number_plate,
      max_capacity_tons
    } = req.body;

    const normalizedNumberPlate = sanitizeNumberPlate(number_plate);

    try {
      // Check for duplicate number plate.
      const {
        data: existing,
        error: checkErr
      } = await supabase
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

      const {
        data: truck,
        error: insertErr
      } = await supabase
        .from('trucks')
        .insert({
          name: sanitizeTruckName(name),
          truck_type,
          number_plate: normalizedNumberPlate,
          max_capacity_tons,
          driver_id: req.user.id
        })
        .select(
          'id, name, truck_type, number_plate, max_capacity_tons, created_at'
        )
        .single();

      if (insertErr) {
        if (insertErr.code === '23505') {
          return res.status(409).json({
            error: 'A truck with this number plate is already registered.'
          });
        }

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
      return res.status(500).json({
        error: 'Internal Server Error',
        details: err?.message
      });
    }
  }
);

// ============================================================================
// LIST DRIVER'S TRUCKS
// ============================================================================

/**
 * @openapi
 * /api/trucks:
 *   get:
 *     tags: [Trucks]
 *     summary: List driver's trucks
 *     description: Returns all trucks owned by the authenticated driver. Supports optional name and capacity filters.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *         description: Filter by name (case-insensitive substring)
 *       - in: query
 *         name: min_capacity
 *         schema:
 *           type: number
 *         description: Minimum capacity filter in tons
 *       - in: query
 *         name: max_capacity
 *         schema:
 *           type: number
 *         description: Maximum capacity filter in tons
 *     responses:
 *       200:
 *         description: List of trucks
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TruckListResponse'
 *       403:
 *         description: Forbidden for non-drivers
 */
router.get(
  '/',
  authenticate,
  requirePolicy('truck:list-own'),
  userLimiter,
  async (req, res) => {
    const {
      name,
      min_capacity,
      max_capacity
    } = req.query;

    try {
      let query = supabase
        .from('trucks')
        .select(
          'id, name, number_plate, max_capacity_tons, created_at'
        )
        .eq('driver_id', req.user.id);

      // Apply exactly one name filter, using the trimmed search term.
      if (name && typeof name === 'string') {
        const cleanName = name.trim();

        if (cleanName) {
          query = query.ilike(
            'name',
            `%${escapeLike(cleanName)}%`
          );
        }
      }

      const minCapacity = parseCapacityFilter(
        min_capacity,
        'min_capacity'
      );

      if (minCapacity.error) {
        return res.status(400).json({
          error: minCapacity.error
        });
      }

      if (minCapacity.value !== undefined) {
        query = query.gte(
          'max_capacity_tons',
          minCapacity.value
        );
      }

      const maxCapacity = parseCapacityFilter(
        max_capacity,
        'max_capacity'
      );

      if (maxCapacity.error) {
        return res.status(400).json({
          error: maxCapacity.error
        });
      }

      if (maxCapacity.value !== undefined) {
        query = query.lte(
          'max_capacity_tons',
          maxCapacity.value
        );
      }

      const {
        data: trucks,
        error
      } = await query.order('created_at', {
        ascending: false
      });

      if (error) {
        return res.status(500).json({
          error: 'Failed to fetch trucks.',
          details: error.message
        });
      }

      return res.json({
        trucks: trucks || []
      });
    } catch (err) {
      return res.status(500).json({
        error: 'Internal Server Error',
        details: err?.message
      });
    }
  }
);

function parseBoolean(value) {
  if (value === undefined) {
    return { value: false };
  }

  if (typeof value === 'boolean') {
    return { value };
  }

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes'].includes(normalized)) {
    return { value: true };
  }

  if (['false', '0', 'no'].includes(normalized)) {
    return { value: false };
  }

  return {
    error: 'Boolean filters must be true or false'
  };
}

function isLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

const MATERIAL_TRUCK_COMPATIBILITY = Object.freeze({
  Textile: ['Open Body', 'Closed Body', 'Container'],
  Electronics: ['Closed Body', 'Container'],
  Food: ['Closed Body', 'Container', 'Refrigerated'],
  Machinery: ['Open Body', 'Container'],
  Furniture: ['Closed Body', 'Container']
});

async function canViewTruckNumber(user, truck) {
  if (user.role === 'admin' || truck.driver_id === user.id) {
    return { allowed: true };
  }

  const {
    data: order,
    error
  } = await supabase
    .from('orders')
    .select('id')
    .eq('truck_id', truck.id)
    .or(`customer_id.eq.${user.id},driver_id.eq.${user.id}`)
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      allowed: false,
      error
    };
  }

  return {
    allowed: Boolean(order)
  };
}
