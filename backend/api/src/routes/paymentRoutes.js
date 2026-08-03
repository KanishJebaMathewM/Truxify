import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { orderRepository, logger } from '../core/container.js';
import { lockPayment, paisaToMaticWei } from '../services/escrow.js';
import { DomainError } from '../services/order/domainError.js';

const router = express.Router();

const lockPaymentSchema = z.object({
  bookingId: z.string(), // Order UUID or display ID
  upiReference: z.string(),
  amount: z.number().positive(), // Paid amount in paisa
});

router.post('/lock', authenticate, userLimiter, validateBody(lockPaymentSchema), async (req, res) => {
  try {
    const { bookingId, upiReference, amount } = req.body;

    // 1. Fetch order details from database
    const order = await orderRepository.findOrderByAnyId(bookingId, '*');
    if (!order || !order.data) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const orderData = order.data;

    // Ensure only the customer who created it or admin can lock it
    if (orderData.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    }

    if (orderData.escrow_status === 'funded') {
      return res.status(200).json({
        success: true,
        message: 'Payment is already locked in escrow.',
        txHash: orderData.deposit_tx_hash,
        bookingId: orderData.escrow_booking_id
      });
    }

    // Retrieve fresh driver and customer wallets
    const driverId = orderData.driver_id;
    if (!driverId) {
      return res.status(422).json({ error: 'No driver is assigned to this order yet.' });
    }

    const { data: driverDetails } = await orderRepository.findDriverWallet(driverId);
    const driverWallet = driverDetails?.polygon_wallet_address ?? null;

    const { data: customerProfile } = await orderRepository.findCustomerWallet(req.user.id);
    const customerWallet = customerProfile?.polygon_wallet_address ?? null;

    if (!driverWallet || !customerWallet) {
      return res.status(422).json({
        error: 'Wallet disconnected: customer or driver does not have a registered Polygon address.'
      });
    }

    // Convert the paid amount to Matic Wei
    const amountWei = paisaToMaticWei(amount);

    // Call the smart contract lockPayment on-chain
    const result = await lockPayment(
      orderData.order_display_id,
      customerWallet,
      driverWallet,
      amountWei
    );

    if (result.error) {
      logger.error(`[lock-payment] Blockchain lock failed for order ${orderData.order_display_id}: ${result.error}`);
      return res.status(502).json({
        error: 'Failed to lock payment in blockchain escrow.',
        details: result.error
      });
    }

    // Update order status in Postgres
    const { error: updateErr } = await orderRepository.updateOrder(orderData.id, {
      escrow_status: 'funded',
      deposit_tx_hash: result.txHash,
      escrow_deposited_at: new Date().toISOString(),
      escrow_booking_id: result.bookingId,
      upi_reference: upiReference, // Save UPI transaction reference
    });

    if (updateErr) {
      logger.error(`[lock-payment] Database update failed for order ${orderData.id}: ${updateErr.message}`);
      return res.status(500).json({ error: 'Failed to sync escrow status to database.' });
    }

    return res.json({
      success: true,
      message: 'Payment successfully locked in blockchain escrow.',
      txHash: result.txHash,
      bookingId: result.bookingId
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[payments/lock] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
