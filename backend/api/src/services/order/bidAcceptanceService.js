import { ethers } from 'ethers';

import { DomainError } from './domainError.js';

export class BidAcceptanceService {
  constructor({ supabase, buildDepositTxFn, escrowDepositFn, recordDepositTxFn, escrowRefundFn, logger, notificationDispatcher }) {
    this.supabase = supabase;
    this.buildDepositTxFn = buildDepositTxFn || escrowDepositFn || (async () => ({ bookingId: 'mock-booking-id' }));
    this.recordDepositTxFn = recordDepositTxFn;
    this.escrowRefundFn = escrowRefundFn;
    this.logger = logger;
    this.notificationDispatcher = notificationDispatcher;
  }

  async acceptBid({ orderId, bidId, customerId }) {
    const { data: order } = await this.supabase.from('orders').select('order_display_id, customer_id').eq('id', orderId).maybeSingle();
    if (!order || order.customer_id !== customerId) {
      throw new DomainError(403, { error: 'Access Denied: You do not own this order.' });
    }

    const { data: bid } = await this.supabase.from('load_bids').select('*').eq('id', bidId).maybeSingle();
    if (!bid || bid.status !== 'pending') {
      throw new DomainError(404, { error: 'Bid is not active or not found.' });
    }

    const { data: loadOffer, error: loadOfferErr } = await this.supabase.from('load_offers').select('id').eq('order_display_id', order.order_display_id).maybeSingle();
    if (loadOfferErr) {
      throw new DomainError(500, { error: 'Failed to verify bid ownership.', details: loadOfferErr.message });
    }
    if (!loadOffer) {
      throw new DomainError(404, { error: 'Load offer for this order was not found.' });
    }
    if (bid.load_id !== loadOffer.id) {
      throw new DomainError(403, { error: 'Access Denied: Bid does not belong to this order.' });
    }

    const [driverDetailsResult, customerProfileResult] = await Promise.all([
      this.supabase.from('driver_details').select('polygon_wallet_address, rating, truck_id').eq('user_id', bid.driver_id).maybeSingle(),
      this.supabase.from('profiles').select('polygon_wallet_address').eq('id', customerId).maybeSingle(),
    ]);

    const driverWallet = driverDetailsResult.data?.polygon_wallet_address ?? null;
    const customerWallet = customerProfileResult.data?.polygon_wallet_address ?? null;

    if (!driverWallet || !customerWallet) {
      this.logger?.warn?.(`[escrow] Missing wallet address: driver=${!!driverWallet}, customer=${!!customerWallet} — rejecting bid acceptance.`);
      throw new DomainError(422, {
        error: 'Both customer and driver must connect a wallet before escrow can be initiated.'
      });
    }

    const [{ data: profile }, { data: details }] = await Promise.all([
      this.supabase.from('profiles').select('full_name').eq('id', bid.driver_id).maybeSingle(),
      this.supabase.from('driver_details').select('rating, truck_id').eq('user_id', bid.driver_id).maybeSingle(),
    ]);

    let truckInfo = null;
    if (details && details.truck_id) {
      const { data, error: truckErr } = await this.supabase.from('trucks').select('id, name, number_plate').eq('id', details.truck_id).maybeSingle();
      if (truckErr) {
        this.logger?.error?.('Truck lookup error during bid accept:', truckErr.message);
      }
      truckInfo = data;
    }

    // Build the escrow deposit transaction
    const amountWei = ethers.parseEther((bid.bid_amount / 100).toFixed(2).toString());
    const buildResult = await this.buildDepositTxFn(order.order_display_id, customerWallet, driverWallet, amountWei);
    if (!buildResult || !buildResult.txData) {
      throw new DomainError(502, { error: 'Escrow configuration missing or failed.' });
    }
    const depositTx = buildResult?.txData || null;
    const bookingId = buildResult?.bookingId || `escrow:${order.order_display_id}`;

    // Update order with escrow booking info
    const { error: escrowUpdateErr } = await this.supabase.from('orders').update({
      escrow_booking_id: bookingId,
      escrow_status: 'funding',
    }).eq('id', orderId);
    if (escrowUpdateErr) {
      this.logger?.warn?.('[escrow] Failed to update escrow booking reference:', escrowUpdateErr.message);
    }

    // Execute RPC to accept bid
    const { error: rpcErr } = await this.supabase.rpc('accept_bid_tx', {
      p_bid_id: bidId,
      p_order_id: orderId,
      p_load_id: bid.load_id,
      p_driver_id: bid.driver_id,
      p_truck_id: truckInfo?.id || null,
      p_driver_name: profile?.full_name || 'Assigned Driver',
      p_driver_rating: details?.rating || 0.00,
      p_truck_number: truckInfo?.number_plate || 'N/A',
      p_bid_amount: bid.bid_amount,
      p_order_display_id: order.order_display_id,
    });

    if (rpcErr) {
      // Compensating transaction: refund the escrow since RPC failed
      if (bookingId) {
        try {
          await this.escrowRefundFn(order.order_display_id);
          this.logger?.warn?.(`[escrow] Compensating refund issued for order ${order.order_display_id} after RPC failure.`);
        } catch (refundErr) {
          this.logger?.error?.(`[escrow] CRITICAL: Escrow refund also failed for order ${order.order_display_id}:`, refundErr.message);
        }
      }
      // Revert escrow status back to pending since RPC failed
      const { error: revertErr } = await this.supabase.from('orders').update({
        escrow_status: 'pending',
        escrow_booking_id: null,
      }).eq('id', orderId);
      if (revertErr) {
        this.logger?.error?.('[escrow] Failed to revert escrow status after RPC failure:', revertErr.message);
      }
      throw new DomainError(500, {
        error: 'Failed to accept bid atomically.',
        details: rpcErr.message,
        recovery: 'The escrow deposit has been refunded. Please try again.'
      });
    }

    // Record the deposit transaction
    try {
      await this.recordDepositTxFn(order.order_display_id, depositTx?.to, depositTx?.data);
    } catch (recordErr) {
      this.logger?.warn?.('[escrow] Failed to record deposit TX:', recordErr.message);
    }

    // Send notifications
    if (this.notificationDispatcher) {
      try {
        await this.notificationDispatcher({
          orderId,
          bidId,
          orderDisplayId: order.order_display_id,
          driverId: bid.driver_id,
          bidAmount: bid.bid_amount,
        });
      } catch (notifyErr) {
        this.logger?.warn?.('[bidAcceptance] Notification dispatcher failed:', notifyErr.message);
      }
    }

    return {
      status: 200,
      body: {
        message: 'Bid accepted. Driver and truck assigned.',
        depositTx,
      },
    };
  }
}
