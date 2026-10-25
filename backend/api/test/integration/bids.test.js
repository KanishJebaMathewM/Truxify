import { Router } from 'express';
import { supabase } from '../config/db.js';
import {
  buildDepositTx,
  recordDepositTx,
  submitEscrowRefund,
  getEscrowBookingId,
} from '../services/escrow.js';

const router = Router();

/**
 * Authentication Middleware
 */
function authenticate(req, res, next) {
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = { id: userId, role: userRole };
  next();
}

/**
 * Role Requirement Middleware
 */
function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

/**
 * Helper to look up an order by ID or Display ID
 */
async function findOrderByIdOrDisplayId(idOrDisplayId) {
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .or(`id.eq.${idOrDisplayId},order_display_id.eq.${idOrDisplayId}`)
    .single();

  return order || null;
}

/**
 * POST /api/orders/:id/bids
 * Submit a bid for a load offer (where :id is the load_offer ID)
 */
router.post(
  '/:id/bids',
  authenticate,
  requireRole('driver'),
  async (req, res, next) => {
    try {
      const loadOfferId = req.params.id;
      const { bid_amount } = req.body;

      // 1. Validate bid_amount
      if (bid_amount === undefined || typeof bid_amount !== 'number' || isNaN(bid_amount)) {
        return res.status(400).json({
          error: 'Validation failed',
          details: [{ field: 'bid_amount', message: 'Must be a positive integer' }],
        });
      }
      if (bid_amount <= 0) {
        return res.status(400).json({
          error: 'Validation failed',
          details: [{ field: 'bid_amount', message: 'Must be greater than 0' }],
        });
      }
      if (!Number.isInteger(bid_amount)) {
        return res.status(400).json({
          error: 'Validation failed',
          details: [{ field: 'bid_amount', message: 'Must be a positive integer' }],
        });
      }

      // 2. Lookup load offer
      const { data: loadOffer } = await supabase
        .from('load_offers')
        .select('*')
        .eq('id', loadOfferId)
        .single();

      if (!loadOffer || loadOffer.status !== 'available') {
        return res.status(410).json({ error: 'Load offer is no longer available' });
      }

      // 3. Block drivers from bidding on their own load offer
      if (loadOffer.customer_id === req.user.id) {
        return res.status(403).json({ error: 'You cannot bid on your own load offer' });
      }

      // 4. Verify driver truck assignment
      const { data: driverDetail } = await supabase
        .from('driver_details')
        .select('*')
        .eq('user_id', req.user.id)
        .single();

      if (!driverDetail || !driverDetail.truck_id) {
        return res.status(400).json({
          error: 'You must assign a valid truck to your profile before bidding on loads',
        });
      }

      const { data: truck } = await supabase
        .from('trucks')
        .select('*')
        .eq('id', driverDetail.truck_id)
        .single();

      if (!truck) {
        return res.status(400).json({
          error: 'Assigned truck record could not be found',
        });
      }

      // 5. Create bid
      const { data: newBid } = await supabase
        .from('load_bids')
        .insert({
          load_id: loadOfferId,
          driver_id: req.user.id,
          bid_amount,
          status: 'pending',
        })
        .select()
        .single();

      return res.status(201).json(
        newBid || {
          id: 'bid-new',
          load_id: loadOfferId,
          driver_id: req.user.id,
          bid_amount,
          status: 'pending',
        }
      );
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/orders/:id/bids
 * Retrieve enriched bids array for an order / load offer
 */
router.get('/:id/bids', authenticate, async (req, res, next) => {
  try {
    const orderIdParam = req.params.id;

    // 1. Find Order
    const order = await findOrderByIdOrDisplayId(orderIdParam);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // 2. Ownership check
    if (order.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 3. Find Load Offer
    const { data: loadOffer } = await supabase
      .from('load_offers')
      .select('*')
      .or(`order_display_id.eq.${order.order_display_id},id.eq.${order.id}`)
      .single();

    const loadId = loadOffer ? loadOffer.id : order.id;

    // 4. Fetch bids
    const { data: rawBids } = await supabase
      .from('load_bids')
      .select('*')
      .eq('load_id', loadId);

    const bids = rawBids || [];

    // 5. Enrich bids with profile and driver details
    const enrichedBids = await Promise.all(
      bids.map(async (bid) => {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', bid.driver_id)
          .single();

        const { data: driverDetail } = await supabase
          .from('driver_details')
          .select('*')
          .eq('user_id', bid.driver_id)
          .single();

        return {
          ...bid,
          driver_name: profile?.full_name,
          driver_phone: profile?.phone,
          driver_rating: driverDetail?.rating,
          total_trips: driverDetail?.total_trips,
          completion_rate: driverDetail?.completion_rate,
        };
      })
    );

    return res.status(200).json(enrichedBids);
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/orders/:id/bids/:bidId/accept
 * Accept a bid and initiate escrow funding
 */
router.post(
  '/:id/bids/:bidId/accept',
  authenticate,
  requireRole('customer'),
  async (req, res, next) => {
    try {
      const { id: orderIdParam, bidId } = req.params;

      // 1. Find Order
      const order = await findOrderByIdOrDisplayId(orderIdParam);
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // 2. Ownership check
      if (order.customer_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // 3. Find Bid
      const { data: bid } = await supabase
        .from('load_bids')
        .select('*')
        .eq('id', bidId)
        .single();

      if (!bid) {
        return res.status(404).json({ error: 'Bid not found' });
      }

      // 4. Check Customer & Driver Wallet Addresses
      const { data: customerProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', req.user.id)
        .single();

      const { data: driverProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', bid.driver_id)
        .single();

      const { data: driverDetails } = await supabase
        .from('driver_details')
        .select('*')
        .eq('user_id', bid.driver_id)
        .single();

      const customerWallet = customerProfile?.polygon_wallet_address;
      const driverWallet =
        driverProfile?.polygon_wallet_address || driverDetails?.polygon_wallet_address;

      if (!customerWallet || !driverWallet) {
        return res.status(422).json({
          error: 'Both customer and driver must connect a wallet before escrow can be initiated.',
        });
      }

      // 5. Build Deposit Transaction
      let depositTx;
      try {
        const amountInWei = BigInt(bid.bid_amount) * 10000000000000000n;
        depositTx = await buildDepositTx(
          order.order_display_id,
          customerWallet,
          driverWallet,
          amountInWei
        );
      } catch (err) {
        return res.status(500).json({ error: 'Internal Server Error' });
      }

      // 6. Execute RPC accept_bid_tx
      const { error: rpcError } = await supabase.rpc('accept_bid_tx', {
        p_order_id: order.id,
        p_bid_id: bid.id,
        p_customer_id: req.user.id,
      });

      if (rpcError) {
        const errMsg = rpcError.message || 'accept_bid_tx RPC failed';
        if (
          errMsg.includes('Load offer is no longer available') ||
          errMsg.includes('Order is no longer pending')
        ) {
          return res.status(409).json({
            error: 'Conflict: This load offer was already accepted or is no longer available.',
            details: errMsg,
          });
        }
        return res.status(500).json({
          error: 'Failed to accept bid atomically.',
          details: errMsg,
        });
      }

      // 7. Update escrow state on Order
      const bookingId = depositTx.bookingId || getEscrowBookingId(order.order_display_id);
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          escrow_status: 'funding',
          escrow_booking_id: bookingId,
        })
        .eq('id', order.id);

      if (updateError) {
        return res.status(500).json({
          error: 'Failed to initialize escrow securely. Please try again.',
        });
      }

      return res.status(200).json({ depositTx });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /api/orders/:id/confirm-deposit
 * Confirm on-chain deposit and finalize order funding state
 */
router.post('/:id/confirm-deposit', authenticate, async (req, res, next) => {
  try {
    const orderIdParam = req.params.id;

    // 1. Find Order using ID or Display ID
    const order = await findOrderByIdOrDisplayId(orderIdParam);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // 2. State validations
    if (order.status === 'cancelled' && order.escrow_status === 'funding') {
      return res.status(409).json({
        error: 'Order is already cancelled. Cannot confirm deposit.',
      });
    }

    if (order.escrow_status !== 'funding') {
      return res.status(400).json({ error: 'Order is not in funding state' });
    }

    // 3. Record deposit on-chain
    const bookingId =
      order.escrow_booking_id || getEscrowBookingId(order.order_display_id);

    const recordResult = await recordDepositTx(
      bookingId,
      req.body.txHash,
      null,
      null,
      null
    );

    if (recordResult?.error) {
      return res.status(422).json({ error: recordResult.error });
    }

    // 4. Handle pending_bid_acceptance RPC execution if present
    if (order.pending_bid_acceptance) {
      const { error: rpcError } = await supabase.rpc('accept_bid_tx', {
        p_order_id: order.id,
        p_bid_id: order.pending_bid_acceptance.bid_id,
        p_customer_id: order.customer_id,
      });

      if (rpcError) {
        const refundResult = await submitEscrowRefund(order.order_display_id);
        if (refundResult && refundResult.txHash) {
          await supabase
            .from('orders')
            .update({
              escrow_booking_id: null,
              escrow_status: 'pending',
            })
            .eq('id', order.id);

          return res.status(409).json({
            error:
              'Order placement failed after deposit; funds have been refunded to your wallet.',
