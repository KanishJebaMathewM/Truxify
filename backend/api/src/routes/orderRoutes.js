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
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { bidLimiter, userLimiter, safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { validateDocumentBuffer } from '../lib/documentValidation.js';
import { scanDocument } from '../lib/malwareScanner.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { requireIdempotency } from '../middleware/idempotency.js';

import {
  createOrderSchema, submitBidSchema, submitRatingSchema, paramIdSchema, acceptBidParamsSchema,
  updateMilestoneSchema, verifyDeliverySchema, predictDemandSchema, changeDropSchema, cancelOrderSchema,
} from '../validation/requestSchemas.js';

import {
  createOrder,
  getActiveOrders,
  getLoadOffers,
  getEnRouteLoads,
  getOrderHistory,
  getOrderDetails,
  getOrderTimeline,
  submitBid,
  submitRating,
  getBids,
  acceptBid,
  updateMilestone,
  verifyDeliveryController,
  resendOtp,
  changeDrop,
  cancelOrder,
  confirmDeposit,
  predictRideDemand,
  getDriverLocation,
  getLiveRouteGeometry,
} from '../controllers/orderController.js';

const router = express.Router();

const verifyDeliveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || 'unknown',
  store: createStore('rl:verify-delivery:'),
  message: { error: 'Too many delivery verification attempts. Please try again later.' },
});

const milestoneLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  keyGenerator: (req) => req.user.id,
  store: createStore('rl:milestone:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many milestone updates. Please slow down.' },
});

import { getRouteEstimate, getRouteGeometry, buildStraightLineGeometry } from '../services/osrm.js';
import { computeOrderPricing } from '../lib/pricing.js';

const router = express.Router();

const getOrderResource = async (req) => {
  const { id } = req.params;
  if (!id) return null;
  return await orderRepository.findOrderById(id);
};


// 1. CREATE AN ORDER (CUSTOMER)
router.post('/', authenticate, userLimiter, requireRole(['customer']), requireIdempotency(86400), validateBody(createOrderSchema), createOrder);

// 2. FETCH MY ACTIVE ORDERS (CUSTOMER)
router.get('/my/active', authenticate, userLimiter, requireRole(['customer']), getActiveOrders);

// 3. FETCH LOAD OFFERS (MARKETPLACE)
router.get('/load-offers', authenticate, userLimiter, getLoadOffers);

// 4. FETCH EN-ROUTE LOADS (MARKETPLACE)
router.get('/load-offers/en-route', authenticate, userLimiter, getEnRouteLoads);

// 5. FETCH MY ORDER HISTORY (CUSTOMER)
router.get('/history', authenticate, userLimiter, requireRole(['customer']), getOrderHistory);

// 6. FETCH SPECIFIC ORDER DETAILS AND TIMELINE (CUSTOMER OR DRIVER)
router.get('/:id', authenticate, userLimiter, validateParams(paramIdSchema), getOrderDetails);

// 7. FETCH ORDER TIMELINE (CUSTOMER OR DRIVER)
// ============================================================================
router.get('/:id/timeline', authenticate, userLimiter, validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;

  try {
    let order = null;
    if (UUID_RE.test(orderId)) {
      const { data: orderById } = await orderRepository.findOrderForTimeline(orderId);
      order = orderById;
    }
    if (!order) {
      const { data: orderByDisplay } = await orderRepository.findOrderByDisplayForTimeline(orderId);
      order = orderByDisplay;
    }

    if (!order) return res.status(404).json({ error: 'Order not found.' });

// 8. SUBMIT BID FOR LOAD OFFER (DRIVER)
router.post('/:id/bids', authenticate, userLimiter, requireRole(['driver']), bidLimiter, validateParams(paramIdSchema), validateBody(submitBidSchema), submitBid);

// 9. SUBMIT RATING FOR A DELIVERED ORDER (CUSTOMER)
router.post('/:id/ratings', authenticate, userLimiter, requireRole(['customer']), validateParams(paramIdSchema), validateBody(submitRatingSchema), submitRating);

// 10. VIEW BIDS FOR AN ORDER (CUSTOMER)
router.get('/:id/bids', authenticate, userLimiter, requireRole(['customer']), validateParams(paramIdSchema), getBids);

// 11. ACCEPT BID (CUSTOMER)
router.post('/:id/bids/:bidId/accept', authenticate, userLimiter, requireRole(['customer']), requireIdempotency(86400), validateParams(acceptBidParamsSchema), acceptBid);

// 12. UPDATE ORDER MILESTONE (ASSIGNED DRIVER)
router.put('/:id/milestones', authenticate, userLimiter, requireRole(['driver']), milestoneLimiter, validateParams(paramIdSchema), validateBody(updateMilestoneSchema), updateMilestone);

// 13. VERIFY DELIVERY OTP AND RELEASE FUNDS (DRIVER)
router.post('/:id/verify-delivery', authenticate, userLimiter, requireRole(['driver']), verifyDeliveryLimiter, requireIdempotency(86400), validateParams(paramIdSchema), validateBody(verifyDeliverySchema), verifyDeliveryController);

// 14. RESEND DELIVERY OTP (DRIVER)
router.post('/:id/resend-otp', authenticate, userLimiter, resendOtpLimiter, requireRole(['driver']), validateParams(paramIdSchema), resendOtp);

// 15. CHANGE DROP (CUSTOMER)
router.put('/:id/change-drop', authenticate, userLimiter, changeDropLimiter, requireRole(['customer']), validateParams(paramIdSchema), validateBody(changeDropSchema), changeDrop);

// 16. CANCEL ORDER AND REFUND ESCROW (CUSTOMER)
router.post('/:id/cancel', authenticate, userLimiter, requireRole(['customer']), requireIdempotency(86400), validateParams(paramIdSchema), validateBody(cancelOrderSchema), cancelOrder);

// 17. CONFIRM ESCROW DEPOSIT (CUSTOMER)
router.post('/:id/confirm-deposit', authenticate, userLimiter, requireRole(['customer']), validateParams(paramIdSchema), validateBody(z.object({ txHash: z.string().regex(/^0x([A-Fa-f0-9]{64})$/, 'Invalid transaction hash') })), confirmDeposit);

// 18. PREDICT RIDE DEMAND (CUSTOMER OR DRIVER)
router.post('/predict-demand', authenticate, userLimiter, requireRole(['customer', 'driver']), predictDemandLimiter, validateBody(predictDemandSchema), predictRideDemand);

// 19. GET DRIVER LOCATION (CUSTOMER OR DRIVER)
router.get('/:id/driver-location', authenticate, userLimiter, telemetryLimiter, requireRole(['customer', 'driver']), validateParams(paramIdSchema), getDriverLocation);

// 20. GET LIVE ROUTE GEOMETRY (CUSTOMER OR DRIVER)
router.get('/:id/route', authenticate, userLimiter, telemetryLimiter, requireRole(['customer', 'driver']), validateParams(paramIdSchema), getLiveRouteGeometry);

const POD_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
const POD_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const podUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: POD_MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (POD_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function validateAndScanPodFile(file, label) {
  validateDocumentBuffer(file.buffer, file.mimetype);
  const scanResult = await scanDocument(file.buffer);

  if (!scanResult.clean) {
    const err = new Error(`${label} file failed malware scanning.`);
    err.status = 422;
    throw err;
  }
}

// POST /api/orders/:id/pod
// PoD uploads are rate-limited per driver + order: each request may carry up to
// 20MB and triggers a malware scan, so without a limiter a driver could exhaust
// storage, RAM (multer memoryStorage), and scan CPU with an unbounded stream.
router.post('/:id/pod', authenticate, requireRole(['driver']), podUploadLimiter, requireIdempotency(86400), podUpload.fields([{ name: 'signature', maxCount: 1 }, { name: 'photo', maxCount: 1 }]), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { data: order, error: orderErr } = await orderRepository.findOrderById(orderId);

    if (orderErr || !order) return res.status(404).json({ error: 'Order not found' });
    if (order.driver_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: Not your order' });

    let signatureUrl = order.pod_signature_url;
    let photoUrl = order.pod_photo_url;
    let signatureHash = order.pod_signature_hash || null;
    let photoHash = order.pod_photo_hash || null;
    const files = req.files || {};

    let uploadedAny = false;

    if (files.signature && files.signature[0]) {
      const file = files.signature[0];
      try {
        await validateAndScanPodFile(file, 'Signature');
      } catch (validationErr) {
        return res.status(validationErr.status || 400).json({ error: `Invalid signature file: ${validationErr.message}` });
      }
      const ext = file.mimetype === 'image/png' ? 'png' : 'jpg';
      const storagePath = `${req.user.id}/pod_sig_${orderId}_${Date.now()}.${ext}`;
      const { error: upErr } = await createUserClient(req.token).storage
        .from('driver-documents')
        .upload(storagePath, file.buffer, { contentType: file.mimetype });
      if (upErr) {
        logger.error('Signature upload to storage failed:', upErr.message);
        return res.status(500).json({ error: 'Failed to upload signature to storage' });
      }
      signatureUrl = storagePath;
      signatureHash = computeFileHash(file.buffer);
      uploadedAny = true;
    }

    if (files.photo && files.photo[0]) {
      const file = files.photo[0];
      try {
        await validateAndScanPodFile(file, 'Photo');
      } catch (validationErr) {
        return res.status(validationErr.status || 400).json({ error: `Invalid photo file: ${validationErr.message}` });
      }
      const ext = file.mimetype === 'image/png' ? 'png' : 'jpg';
      const storagePath = `${req.user.id}/pod_photo_${orderId}_${Date.now()}.${ext}`;
      const { error: upErr } = await createUserClient(req.token).storage
        .from('driver-documents')
        .upload(storagePath, file.buffer, { contentType: file.mimetype });
      if (upErr) {
        logger.error('Photo upload to storage failed:', upErr.message);
        return res.status(500).json({ error: 'Failed to upload photo to storage' });
      }
      photoUrl = storagePath;
      photoHash = computeFileHash(file.buffer);
      uploadedAny = true;
    }

    if (!uploadedAny) {
      return res.status(400).json({ error: 'At least one valid proof file (signature or photo) is required' });
    }

    const updates = {
      updated_at: new Date().toISOString(),
    };
    if (signatureUrl !== order.pod_signature_url) updates.pod_signature_url = signatureUrl;
    if (photoUrl !== order.pod_photo_url) updates.pod_photo_url = photoUrl;
    if (signatureHash) updates.pod_signature_hash = signatureHash;
    if (photoHash) updates.pod_photo_hash = photoHash;

    const { data: updatedOrder, error: updateErr } = await orderRepository.updateOrder(orderId, updates);

    if (updateErr) {
      logger.error('Failed to update order with PoD:', updateErr.message);
      return res.status(500).json({ error: 'Failed to update order with PoD data' });
    }

    return res.json({
      message: 'Proof of Delivery uploaded successfully',
      photoUrl: updatedOrder.pod_photo_url,
      signatureUrl: updatedOrder.pod_signature_url,
      photoHash: updatedOrder.pod_photo_hash,
      signatureHash: updatedOrder.pod_signature_hash,
      uploadTimestamp: updatedOrder.updated_at,
    });
  } catch (err) {
    logger.error('PoD upload error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// GET /api/orders/history
router.get('/history', authenticate, userLimiter, requirePolicy('order:view-history'), async (req, res) => {
  const { cursor } = req.query;

  if (cursor !== undefined && (!Number.isInteger(Number(cursor)) || Number(cursor) < 1)) {
    return res.status(400).json({ error: 'Invalid cursor parameter. Must be a valid positive integer.' });
  }

  const page = cursor ? parseInt(cursor, 10) : (parseInt(req.query.page, 10) || 1);
  const limit = parseInt(req.query.limit, 10) || 20;

  if (page < 1) {
    return res.status(400).json({ error: 'Invalid page parameter. Must be a positive integer.' });
  }
  if (limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'Invalid limit parameter. Must be between 1 and 100.' });
  }

  try {
    const result = await orderLifecycleService.getOrderHistory(req.user.id, page, limit);
    return res.json(result);
  } catch (err) {
    logger.error('Order history fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch order history.' });
  }
});

// GET /api/orders/my/active
router.get('/my/active', authenticate, userLimiter, requirePolicy('order:view-active'), async (req, res) => {
  try {
    const orders = await orderLifecycleService.getActiveOrders(req.user.id);
    return res.json(orders);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Active orders fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch active orders.' });
  }
});

// GET /api/orders/my/history
router.get('/my/history', authenticate, userLimiter, requirePolicy('order:view-history'), async (req, res) => {
  const { cursor } = req.query;

  if (cursor !== undefined && (!Number.isInteger(Number(cursor)) || Number(cursor) < 1)) {
    return res.status(400).json({ error: 'Invalid cursor parameter. Must be a valid positive integer.' });
  }

  const page = cursor ? parseInt(cursor, 10) : (parseInt(req.query.page, 10) || 1);
  const limit = parseInt(req.query.limit, 10) || 20;

  if (page < 1) {
    return res.status(400).json({ error: 'Invalid page parameter. Must be a positive integer.' });
  }
  if (limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'Invalid limit parameter. Must be between 1 and 100.' });
  }

  try {
    const result = await orderLifecycleService.getOrderHistory(req.user.id, page, limit);
    return res.json(result);
  } catch (err) {
    logger.error('Order history fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch order history.' });
  }
});

// GET /api/orders/:id/timeline
router.get('/:id/timeline', authenticate, userLimiter, requirePolicy('order:view-timeline', async (req) => {
  const order = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id');
  return { order };
}), validateParams(paramIdSchema), async (req, res) => {
  try {
    const timeline = await orderLifecycleService.getOrderTimeline(req.params.id, req.user.id);
    return res.json(timeline);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Order timeline fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch order timeline.' });
  }
});

// GET /api/orders/:id
router.get('/:id', authenticate, userLimiter, requirePolicy('order:view', async (req) => {
  const order = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id');
  return { order };
}), validateParams(paramIdSchema), async (req, res) => {
  try {
    const detail = await orderLifecycleService.getOrderDetail(req.params.id, req.user.id);
    return res.json(detail);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Order detail fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch order.' });
  }
});

export default router;
