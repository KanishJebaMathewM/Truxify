const express = require('express');
const router = express.Router();
const orderRepository = require('../repositories/orderRepository');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { userLimiter, bidLimiter } = require('../middleware/rateLimiter');
const { validateParams, validateBody } = require('../middleware/validation');
const { paramIdSchema, submitBidSchema, confirmDepositSchema } = require('../validators/orderValidators');
const { DomainError } = require('../errors/DomainError');
const logger = require('../utils/logger');

// ============================================================================
// 17. CONFIRM ORDER DEPOSIT / ESCROW LOCK — POST /api/orders/:id/confirm-deposit
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/confirm-deposit:
 *   post:
 *     tags: [Orders]
 *     summary: Confirm deposit or escrow lock for an order
 *     description: Verifies and locks the deposit/escrow funds required to proceed with an order.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ConfirmDepositRequest'
 *     responses:
 *       200:
 *         description: Deposit confirmed and escrow locked successfully
 *       400:
 *         description: Invalid transaction reference or insufficient funds
 *       404:
 *         description: Order not found
 */
router.post('/:id/confirm-deposit', authenticate, userLimiter, validateParams(paramIdSchema), validateBody(confirmDepositSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user.id;
    const { paymentIntentId, amount } = req.body;

    const order = await orderRepository.findOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.customer_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized access to this order' });
    }

    const depositResult = await orderRepository.lockEscrowDeposit({
      orderId,
      paymentIntentId,
      amount,
    });

    if (depositResult.error) {
      logger.error('[confirm-deposit] Escrow lock failed:', depositResult.error.message);
      return res.status(400).json({ error: depositResult.error.message || 'Failed to confirm deposit' });
    }

    return res.status(200).json({
      message: 'Deposit confirmed and escrow locked successfully',
      order: depositResult.data,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[confirm-deposit] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 18a. SUBMIT BID FOR A LOAD (DRIVER) — POST /api/orders/:id/bids
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids:
 *   post:
 *     tags: [Orders]
 *     summary: Submit a bid for an order load
 *     description: Allows an authenticated driver to submit a bid amount (in paisa) for an available order.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SubmitBidRequest'
 *     responses:
 *       201:
 *         description: Bid submitted successfully
 *       400:
 *         description: Invalid input or missing required fields
 *       404:
 *         description: Order not found
 */
router.post('/:id/bids', authenticate, userLimiter, requireRole(['driver']), bidLimiter, validateParams(paramIdSchema), validateBody(submitBidSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const driverId = req.user.id;
    const { amount } = req.body;

    const order = await orderRepository.findOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const bidData = {
      order_id: orderId,
      driver_id: driverId,
      amount,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    const { data, error } = await orderRepository.createBid(bidData);
    if (error) {
      logger.error('[submit-bid] Failed to insert bid:', error.message);
      return res.status(500).json({ error: 'Failed to submit bid' });
    }

    return res.status(201).json({ message: 'Bid submitted successfully', bid: data });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[submit-bid] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 18b. VIEW BIDS FOR AN ORDER (CUSTOMER) — GET /api/orders/:id/bids
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids:
 *   get:
 *     tags: [Orders]
 *     summary: View all bids for a specific order
 *     description: Allows the order owner or admin to review submitted driver bids.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *       200:
 *         description: List of bids retrieved successfully
 *       403:
 *         description: Unauthorized to view bids for this order
 *       404:
 *         description: Order not found
 */
router.get('/:id/bids', authenticate, userLimiter, validateParams(paramIdSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user.id;

    const order = await orderRepository.findOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.customer_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized access to order bids' });
    }

    const { data: bids, error } = await orderRepository.findBidsByOrderId(orderId);
    if (error) {
      logger.error('[get-bids] Failed to retrieve bids:', error.message);
      return res.status(500).json({ error: 'Failed to fetch bids' });
    }

    return res.status(200).json({ bids });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[get-bids] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 18c. ACCEPT A BID (CUSTOMER) — POST /api/orders/:id/bids/:bidId/accept
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids/{bidId}/accept:
 *   post:
 *     tags: [Orders]
 *     summary: Accept a specific driver bid
 *     description: Assigns the order to the winning driver and rejects other pending bids.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: bidId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Bid accepted successfully and order assigned
 *       400:
 *         description: Bid is already expired or invalid
 *       403:
 *         description: Unauthorized action
 *       404:
 *         description: Order or bid not found
 */
router.post('/:id/bids/:bidId/accept', authenticate, userLimiter, validateParams(paramIdSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { bidId } = req.params;
    const userId = req.user.id;

    const order = await orderRepository.findOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.customer_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized to accept bids for this order' });
    }

    const result = await orderRepository.acceptBidTransaction(orderId, bidId);
    if (result.error) {
      logger.error('[accept-bid] Transaction failed:', result.error.message);
      return res.status(400).json({ error: result.error.message || 'Failed to accept bid' });
    }

    return res.status(200).json({
      message: 'Bid accepted successfully',
      order: result.order,
      acceptedBid: result.bid,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[accept-bid] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
