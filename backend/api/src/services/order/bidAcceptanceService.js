import { paisaToMaticWei } from '../escrow.js';
import { DomainError } from './domainError.js';
import { measureExecution } from '../../core/performanceMetrics.js';

// Re-export for backward compatibility — prefer importing from domainError.js
export { DomainError } from './domainError.js';

export class BidAcceptanceService {
  constructor({ orderRepository, buildDepositTxFn, escrowDepositFn, recordDepositTxFn, escrowRefundFn, logger, notificationDispatcher }) {
    this.orderRepository = orderRepository;
    this.buildDepositTxFn = buildDepositTxFn || escrowDepositFn || (async () => ({ bookingId: 'mock-booking-id' }));
    this.recordDepositTxFn = recordDepositTxFn;
    this.escrowRefundFn = escrowRefundFn;
    this.logger = logger;
    this.notificationDispatcher = notificationDispatcher;
  }

  async acceptBid({ orderId, bidId, customerId }) {
    return measureExecution('BidAcceptanceService.acceptBid', async () => {
    const { data: order, error: orderErr } = await this.orderRepository.findOrderById(orderId, 'order_display_id, customer_id, version');
    if (orderErr) {
      throw new DomainError(500, { error: 'Failed to retrieve order.', details: orderErr.message });
    }
    if (!order || order.customer_id !== customerId) {
      throw new DomainError(403, { error: 'Access Denied: You do not own this order.' });
    }

    const { data: bid, error: bidErr } = await this.orderRepository.findBidById(bidId);
    if (bidErr) {
      throw new DomainError(500, { error: 'Failed to retrieve bid.', details: bidErr.message });
    }
    if (!bid || bid.status !== 'pending') {
      throw new DomainError(404, { error: 'Bid is not active or not found.' });
    }

    const { data: loadOffer, error: loadOfferErr } = await this.orderRepository.findLoadOfferByOrderDisplayId(order.order_display_id);
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
      this.orderRepository.findDriverDetail(bid.driver_id),
      this.orderRepository.findCustomerWallet(customerId),
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
      this.orderRepository.findProfile(bid.driver_id, 'full_name'),
      this.orderRepository.findDriverDetailWithRating(bid.driver_id),
    ]);

    let truckInfo = null;
    if (details && details.truck_id) {
      const { data: truck, error: truckErr } = await this.orderRepository.findTruckWithDetails(details.truck_id);
      if (truckErr) {
        this.logger?.error?.('Truck lookup error during bid accept:', truckErr.message);
      }
      truckInfo = truck;
    }

    // Re-validate wallets immediately before escrow deposit (close TOCTOU window)
    const { data: freshDriverDetails } = await this.orderRepository.findDriverDetail(bid.driver_id);
    const { data: freshCustomerProfile } = await this.orderRepository.findCustomerWallet(customerId);
    const freshDriverWallet = freshDriverDetails?.polygon_wallet_address ?? null;
    const freshCustomerWallet = freshCustomerProfile?.polygon_wallet_address ?? null;

    if (!freshDriverWallet || !freshCustomerWallet) {
      this.logger?.warn?.(`[escrow] Wallet disconnected between validation and deposit: driver=${!!freshDriverWallet}, customer=${!!freshCustomerWallet}`);
      throw new DomainError(422, {
        error: 'A wallet was disconnected before the escrow deposit could be initiated. Please reconnect your wallet and try again.'
      });
    }

    // Build the escrow deposit transaction
    let depositTx = null;
    let bookingId = null;
    const amountWei = paisaToMaticWei(bid.bid_amount);
    try {
      const buildResult = await this.buildDepositTxFn(order.order_display_id, customerWallet, driverWallet, amountWei);
      depositTx = buildResult;
      bookingId = buildResult?.bookingId || `escrow:${order.order_display_id}`;
    } catch (buildErr) {
      throw buildErr; // Let it bubble up as a generic error to return 500
    }

    // Guard against silent escrow disable: if buildDepositTx returned
    // null txData (contract not initialised), reject immediately.
    if (!depositTx?.txData) {
      this.logger?.error?.('[escrow] Escrow deposit tx could not be built — escrow contract is not reachable or misconfigured.');
      throw new DomainError(502, {
        error: 'Escrow is not configured. Escrow deposit transaction could not be built.',
        details: 'The escrow contract is unreachable or the blockchain environment variables are not set.',
        recovery: 'This order cannot proceed with escrow protection. Please contact support.',
      });
    }

    // Update order with escrow booking info
    const { error: escrowUpdateErr } = await this.orderRepository.updateEscrowBooking(orderId, bookingId, 'funding');
    if (escrowUpdateErr) {
      throw new DomainError(500, { error: 'Failed to store escrow booking reference.', details: escrowUpdateErr.message });
    }

    // Execute RPC to accept bid
    if (order.version == null) {
      throw new DomainError(500, {
        error: 'Order version is missing. Cannot safely accept bid.',
        recovery: 'Please retry the request.',
      });
    }

    const { error: rpcErr } = await this.orderRepository.executeRpc('accept_bid_tx', {
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
      p_expected_version: order.version,
    });

    if (rpcErr) {
      if (bookingId) {
        try {
          await this.escrowRefundFn(order.order_display_id);
          this.logger?.warn?.(`[escrow] Compensating refund issued for order ${order.order_display_id} after RPC failure.`);
        } catch (refundErr) {
          this.logger?.error?.(`[escrow] CRITICAL: Escrow refund also failed for order ${order.order_display_id}:`, refundErr.message);
        }
      }
      // Revert escrow status back to pending since RPC failed
      const { error: revertErr } = await this.orderRepository.revertEscrowStatus(orderId);
      if (revertErr) {
        this.logger?.error?.('[escrow] Failed to revert escrow status after RPC failure:', revertErr.message);
      }

      if (rpcErr.message?.includes('OPTIMISTIC_LOCK_FAIL') || rpcErr.message?.includes('Load offer is no longer available') || rpcErr.message?.includes('Order is no longer pending')) {
        throw new DomainError(409, {
          error: 'Conflict: This load offer was already accepted or is no longer available.',
          details: rpcErr.message
        });
      }

      throw new DomainError(500, {
        error: 'Failed to accept bid atomically.',
        details: rpcErr.message,
        recovery: 'The escrow deposit has been refunded. Please try again.'
      });
    }

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
    });
  }
}
