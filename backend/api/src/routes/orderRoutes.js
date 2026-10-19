/**
 * @openapi
 * components:
 *   schemas:
 *     CreateOrderRequest:
 *       type: object
 *       properties:
 *         pickup_address:
 *           type: string
 *         drop_address:
 *           type: string
 *         pickup_lat:
 *           type: number
 *         pickup_lng:
 *           type: number
 *         drop_lat:
 *           type: number
 *         drop_lng:
 *           type: number
 *         weight_tonnes:
 *           type: number
 *         goods_type:
 *           type: string
 *         is_fragile:
 *           type: boolean
 *         is_stackable:
 *           type: boolean
 *     OrderListResponse:
 *       type: object
 *       properties:
 *         page:
 *           type: integer
 *         limit:
 *           type: integer
 *         total:
 *           type: integer
 *         totalPages:
 *           type: integer
 *         orders:
 *           type: array
 *           items:
 *             type: object
 *     SubmitBidRequest:
 *       type: object
 *       required:
 *         - amount
 *       properties:
 *         amount:
 *           type: number
 *           description: Bid amount in paisa
 *     SubmitRatingRequest:
 *       type: object
 *       required:
 *         - rating
 *       properties:
 *         rating:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *         review:
 *           type: string
 *     AcceptBidResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         order:
 *           type: object
 *     UpdateMilestoneRequest:
 *       type: object
 *       required:
 *         - milestone
 *       properties:
 *         milestone:
 *           type: string
 *     VerifyDeliveryResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *     ChangeDropRequest:
 *       type: object
 *       required:
 *         - drop_lat
 *         - drop_lng
 *       properties:
 *         drop_lat:
 *           type: number
 *         drop_lng:
 *           type: number
 *         drop_address:
 *           type: string
 *     CancelOrderRequest:
 *       type: object
 *       required:
 *         - reason
 *       properties:
 *         reason:
 *           type: string
 *     PredictDemandRequest:
 *       type: object
 *       properties:
 *         pickup_lat:
 *           type: number
 *         pickup_lng:
 *           type: number
 *         drop_lat:
 *           type: number
 *         drop_lng:
 *           type: number
 *     DriverLocationResponse:
 *       type: object
 *       properties:
 *         driver_id:
 *           type: string
 *         lat:
 *           type: number
 *         lng:
 *           type: number
 *         updated_at:
 *           type: string
 *     OrderRouteResponse:
 *       type: object
 *       properties:
 *         route:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               lat:
 *                 type: number
 *               lng:
 *                 type: number
 *         distance_km:
 *           type: number
 *         duration_minutes:
 *           type: number
 */

import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import {
  bidLimiter,
  userLimiter,
  safeIpKeyGenerator,
  userKeyGenerator,
  podUploadLimiter,
  createStore,
  verifyDeliveryLimiter,
  resendOtpLimiter,
  changeDropLimiter,
  predictDemandLimiter,
  telemetryLimiter,
} from '../middleware/rateLimiter.js';
import { mongoDb, supabase, redisClient, createUserClient, supabaseAdmin } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { validateDocumentBuffer } from '../lib/documentValidation.js';
import { scanDocument } from '../lib/malwareScanner.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  createOrderSchema, submitBidSchema, submitRatingSchema, paramIdSchema, acceptBidParamsSchema,
  updateMilestoneSchema, verifyDeliverySchema, predictDemandSchema, changeDropSchema, cancelOrderSchema,
} from '../validation/requestSchemas.js';
import { awardReputationPoints } from '../services/reputation.js';
import { expireDeliveryOtps, sendPushNotification } from '../services/notificationService.js';
import { DomainError } from '../services/order/domainError.js';
import { predictDemand, predictPrice, matchEnRouteLoads } from '../services/ml.js';
import { getEscrowBookingId, resolveExpectedDepositAmount, paisaToMaticWei, submitEscrowRefund } from '../services/escrow.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { acquireLockOrFallback } from '../lib/lockFallback.js';
import { acquireLock, releaseLock, LockAcquisitionError } from '../lib/redisLock.js';
import logger from '../middleware/logger.js';
import { invalidateBookingCaches } from '../utils/cacheInvalidation.js';
import { auditLog } from '../middleware/auditLog.js';
import {
  orderRepository,
  orderValidationService,
  orderTimelineService,
  orderMilestoneService,
  orderLifecycleService,
  deliveryVerificationService,
  buildDepositTx,
  recordDepositTx,
  confirmEscrowRefund,
} from '../core/container.js';
import {
  createOrder,
  getActiveOrders,
  getLoadOffers,
  getOrderHistory,
  getOrderDetails,
  verifyDeliveryController,
  resendOtp,
  changeDrop,
  cancelOrder,
  predictRideDemand,
} from '../controllers/orderController.js';
import { getRouteEstimate, getRouteGeometry, buildStraightLineGeometry } from '../services/osrm.js';
import { computeOrderPricing } from '../lib/pricing.js';
import {
  validatePodFile,
  generatePodStoragePath,
  uploadPodFile,
  createPodSignedUrl
} from '../lib/storage/podStorage.js';
import { escrowLockManager } from '../lib/escrow/escrowLockManager.js';

const router = express.Router();
const MAX_
