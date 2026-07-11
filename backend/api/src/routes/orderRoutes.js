import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { bidLimiter, userLimiter, safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { requireIdempotency } from '../middleware/idempotency.js';

import {
  createOrderSchema,
  submitBidSchema,
  submitRatingSchema,
  paramIdSchema,
  acceptBidParamsSchema,
  updateMilestoneSchema,
  verifyDeliverySchema,
  predictDemandSchema,
  changeDropSchema,
  cancelOrderSchema,
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

const predictDemandLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  keyGenerator: (req) => req.user?.id || 'unauthenticated',
  store: createStore('rl:predict-demand:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many demand prediction requests. Please try again later.' },
});

const telemetryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 30,
  keyGenerator: (req) => {
    if (!req.user || !req.user.id) {
      return req.ip ? safeIpKeyGenerator(req) : 'unknown-ip';
    }
    return req.user.id;
  },
  store: createStore('rl:telemetry:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many telemetry requests. Please try again later.' },
});

const resendOtpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || 'unknown',
  store: createStore('rl:resend-otp:'),
  message: { error: 'Too many OTP resend requests. Please try again later.' },
});

const changeDropLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || 'unknown',
  store: createStore('rl:change-drop:'),
  message: { error: 'Too many drop change requests. Please try again later.' },
});

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

export default router;
