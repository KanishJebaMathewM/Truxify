import { paisaToMaticWei, getEscrowBookingId } from '../escrow.js';
import { DomainError } from './domainError.js';
import { measureExecution } from '../../core/performanceMetrics.js';
import { acquireLock, releaseLock } from '../../lib/redisLock.js';

// Re-export for backward compatibility — prefer importing from domainError.js
export { DomainError } from './domainError.js';

// Once the escrow money has moved, or the order is finished, a new bid can
// never be accepted — doing so would orphan the on-chain escrow and the
// already-assigned driver.
const BLOCKED_ESCROW_STATUSES = ['funded', 'released', 'refunded'];
const TERMINAL_ORDER_STATUSES = ['delivered', 'cancelled', 'payment_released'];

// updateEscrowBooking only flips the order to 'funding' while it is still in
// an accepting state (escrow untouched, no pending acceptance), closing the
// concurrent double-accept TOCTOU window: the second writer matches no row.
const ESCROW_RESET_GUARD_FILTERS = [
  { op: 'or', value: 'escrow_status.is.null,escrow_status.eq.pending' },
  { op: 'is', column: 'pending_bid_acceptance', value: null },
];

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
      const lockKey = `escrow_lock:${orderId}`;
      const lockValue = await acquireLock(lockKey, 10000);
      if (!lockValue) {
        throw new DomainError(409, { error: 'Another bid acceptance is in progress for this order. Please try again.' });
      }

      try {
        const { data: order, error: orderErr } = await this.orderRepository.findOrderById(
          orderId, 'order_display_id, customer_id, version, status, escrow_status, pending_bid_acceptance'
        );
        if (orderErr) {
          throw new DomainError(500, { error: 'Failed to retrieve order.', details: orderErr.message });
        }
        if (!order || order.customer_id !== customerId) {
          throw new DomainError(403, { error: 'Access Denied: You do not own this order.' });
        }

        if (['completed', 'cancelled'].includes(order.status)) {
          throw new DomainError(409, {
            error: `Cannot accept bid: order is already ${order.status}.`
          });
        }

        if (['funded', 'released', 'refunded'].includes(order.escrow_status)) {
          throw new DomainError(409, {
            error: `Cannot accept bid: escrow is already ${order.escrow_status}.`
          });
        }

        // Two-phase guard: if funding for another bid is already in flight, block
        // further acceptances until the pending escrow deposit is confirmed.
        if (order.escrow_status === 'funding' && order.pending_bid_acceptance) {
          throw new DomainError(409, {
            error: 'Funding has already been initiated for a bid on this order. Confirm the pending escrow deposit before accepting another bid.'
          });
        }

        // Guard: never re-accept once the escrow funds have moved or the order
        // has reached a terminal state — the funds on-chain and the assigned
        // driver would be orphaned by resetting the booking to 'funding'.
        if (BLOCKED_ESCROW_STATUSES.includes(order.escrow_status)) {
          throw new DomainError(409, {
            error: `Bid cannot be accepted: escrow is already ${order.escrow_status}.`
          });
        }
        if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
          throw new DomainError(409, {
            error: `Bid cannot be accepted: order is already ${order.status}.`
          });
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
        let amountWei;
        try {
          amountWei = paisaToMaticWei(bid.bid_amount);
        } catch (err) {
          throw new DomainError(422, {
            error: 'Deposit amount exceeds the escrow safety cap.',
            details: err.message,
            recovery: 'Configure ESCROW_MATIC_PER_PAISA / MAX_ESCROW_MATIC or contact support for a larger escrow limit.',
          });
        }
        const depositTx = await this.buildDepositTxFn(order.order_display_id, freshDriverWallet, amountWei);
        const bookingId = depositTx?.bookingId || getEscrowBookingId(order.order_display_id);

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

        // Persist the escrow booking reference PLUS the full bid-acceptance context
        // needed by confirm-deposit to finalize the driver assignment atomically.
        // Two-phase design (#5724): the driver is NOT committed here. accept_bid_tx
        // runs only from confirm-deposit, AFTER the on-chain deposit is verified.
        if (order.version == null) {
          throw new DomainError(500, {
            error: 'Order version is missing. Cannot safely reserve a bid.',
            recovery: 'Please retry the request.',
          });
        }

        const pendingAcceptance = {
          bid_id: bidId,
          load_id: bid.load_id,
          driver_id: bid.driver_id,
          truck_id: truckInfo?.id || null,
          driver_name: profile?.full_name || 'Assigned Driver',
          driver_rating: details?.rating || 0.00,
          truck_number: truckInfo?.number_plate || 'N/A',
          bid_amount: bid.bid_amount,
          order_display_id: order.order_display_id,
          version: order.version,
        };

        const { data: escrowUpdateResult, error: escrowUpdateErr } = await this.orderRepository.updateEscrowBooking(orderId, bookingId, 'funding', {
          escrow_amount_wei: amountWei.toString(),
          escrow_driver_wallet: freshDriverWallet,
          escrow_funding_started_at: new Date().toISOString(),
          pending_bid_acceptance: pendingAcceptance,
        }, ESCROW_RESET_GUARD_FILTERS);
        if (escrowUpdateErr) {
          // No row matched the guard (PGRST116) — a concurrent acceptance or an
          // escrow that already advanced won the race. Report it as a conflict,
          // never as a server failure, and never overwrite the existing booking.
          if (escrowUpdateErr.code === 'PGRST116' || String(escrowUpdateErr.message).includes('no rows')) {
            throw new DomainError(409, {
              error: 'This order already has an active escrow flow. Reload the order before accepting another bid.'
            });
          }
          throw new DomainError(500, { error: 'Failed to store escrow booking reference.', details: escrowUpdateErr.message });
        }
        if (!escrowUpdateResult) {
          throw new DomainError(409, {
            error: 'This order already has an active escrow flow. Reload the order before accepting another bid.'
          });
        }

        return {
          status: 200,
          body: {
            message: 'Bid reserved. Complete the escrow deposit to finalize the driver assignment.',
            depositTx,
          },
        };
      } finally {
        await releaseLock(lockKey, lockValue);
      }
    });
  }
}
