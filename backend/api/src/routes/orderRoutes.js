// Continuing from previous block...

// ============================================================================
// 18. BIDS & MARKETPLACE ROUTING
// ============================================================================

/**
 * @openapi
 * /api/orders/{id}/bids:
 *   post:
 *     tags: [Orders]
 *     summary: Submit a bid for a load (Driver)
 *     description: Allows a verified driver to submit a freight bid for an available order.
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
 *         description: Invalid input or bad bid amount
 */
router.post('/:id/bids', authenticate, userLimiter, requireRole(['driver']), bidLimiter, requireIdempotency(3600), validateParams(paramIdSchema), validateBody(submitBidSchema), async (req, res) => {
  const orderId = req.params.id;
  const { amount } = req.body;
  const driverId = req.user.id;

  try {
    const { data: order, error: orderErr } = await orderRepository.findOrderById(orderId);
    if (orderErr || !order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (order.status !== 'created' && order.status !== 'marketplace') {
      return res.status(409).json({ error: 'Order is no longer accepting bids.' });
    }

    const { data: driverProfile, error: profileErr } = await orderRepository.findDriverProfile(driverId);
    if (profileErr || !driverProfile) {
      return res.status(403).json({ error: 'Driver profile not found or unverified.' });
    }

    const bidRecord = {
      order_id: orderId,
      driver_id: driverId,
      amount_paisa: amount,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    const { data: savedBid, error: saveErr } = await orderRepository.insertBid(bidRecord);
    if (saveErr) {
      logger.error('[bids] Failed to insert bid:', saveErr.message);
      return res.status(500).json({ error: 'Failed to submit bid.' });
    }

    return res.status(201).json({
      message: 'Bid submitted successfully.',
      bid: savedBid,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[bids] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * @openapi
 * /api/orders/{id}/bids:
 *   get:
 *     tags: [Orders]
 *     summary: View bids for an order (Customer)
 *     description: Returns all active bids submitted by drivers for a customer's specific order.
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
 *         description: List of bids retrieved successfully
 */
router.get('/:id/bids', authenticate, userLimiter, requireRole(['customer']), validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;

  try {
    const { data: order, error: orderErr } = await orderRepository.findOrderById(orderId);
    if (orderErr || !order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (order.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to view bids for this order.' });
    }

    const { data: bids, error: bidsErr } = await orderRepository.findBidsForOrder(orderId);
    if (bidsErr) {
      logger.error('[bids] Failed to fetch bids:', bidsErr.message);
      return res.status(500).json({ error: 'Failed to retrieve bids.' });
    }

    return res.json({ bids: bids || [] });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[bids] GET exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * @openapi
 * /api/orders/{id}/bids/{bidId}/accept:
 *   post:
 *     tags: [Orders]
 *     summary: Accept a driver bid (Customer)
 *     description: Accepts a specific driver bid, moving the order into escrow funding state.
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
 *         description: Bid accepted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AcceptBidResponse'
 */
router.post('/:id/bids/:bidId/accept', authenticate, userLimiter, requireRole(['customer']), requireIdempotency(3600), validateParams(z.object({
  id: z.string().uuid('Invalid order ID format'),
  bidId: z.string().uuid('Invalid bid ID format'),
})), async (req, res) => {
  const orderId = req.params.id;
  const bidId = req.params.bidId;

  try {
    const { data: order, error: orderErr } = await orderRepository.findOrderById(orderId);
    if (orderErr || !order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (order.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to accept bids for this order.' });
    }

    const { data: bid, error: bidErr } = await orderRepository.findBidById(bidId);
    if (bidErr || !bid || bid.order_id !== orderId) {
      return res.status(404).json({ error: 'Bid not found for this order.' });
    }

    const bookingId = order.order_display_id ? getEscrowBookingId(order.order_display_id) : orderId;

    const { data: updatedOrder, error: updateErr } = await orderRepository.updateOrder(orderId, {
      escrow_status: 'funding',
      status: 'pending_funding',
      escrow_booking_id: bookingId,
      pending_bid_acceptance: {
        bid_id: bid.id,
        driver_id: bid.driver_id,
        bid_amount: bid.amount_paisa,
        order_display_id: order.order_display_id,
        version: order.version || 1,
      },
    });

    if (updateErr) {
      logger.error('[bids] Failed to update order during bid acceptance:', updateErr.message);
      return res.status(500).json({ error: 'Failed to accept bid.' });
    }

    return res.json({
      message: 'Bid accepted successfully. Please fund escrow to finalize assignment.',
      order: updatedOrder,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[bids] Accept exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
