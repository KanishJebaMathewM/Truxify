import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { orderValidationService } from '../core/container.js';
import { getEscrowBookingId, getEscrowBooking } from '../services/escrow.js';
import logger from '../middleware/logger.js';

const router = express.Router();

router.get('/receipt/:tripId', authenticate, async (req, res) => {
  const { tripId } = req.params;
  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(
      tripId,
      'id, order_display_id, customer_id, driver_id, pickup_address, drop_address, total_amount, blockchain_tx_hash, escrow_booking_id, status, completed_at, created_at'
    );

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Assert that the requesting user is the customer or assigned driver of the order, or support/admin
    if (
      order.customer_id !== req.user.id &&
      order.driver_id !== req.user.id &&
      req.user.role !== 'admin' &&
      req.user.role !== 'support'
    ) {
      return res.status(403).json({ error: 'Unauthorized to view this order receipt' });
    }

    const bookingId = order.escrow_booking_id || getEscrowBookingId(order.order_display_id || order.id);
    const onChainBooking = await getEscrowBooking(bookingId);

    res.json({
      orderId: order.order_display_id || order.id,
      origin: order.pickup_address,
      destination: order.drop_address,
      price: order.total_amount,
      driver: onChainBooking?.driver || order.driver_id || '0x0000000000000000000000000000000000000000',
      timestamp: order.completed_at || order.created_at,
      txHash: order.blockchain_tx_hash || '0x0000000000000000000000000000000000000000000000000000000000000000'
    });
  } catch (err) {
    logger.error(`[blockchainRoutes] Failed to fetch receipt: ${err.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
