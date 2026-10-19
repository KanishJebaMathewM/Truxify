import { paisaToMaticWei, getEscrowBookingId } from '../escrow.js';
import { DomainError } from './domainError.js';
import { measureExecution } from '../../core/performanceMetrics.js';
import { acquireLockOrFallback } from '../../lib/lockFallback.js';

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
  constructor({ orderRepository, buildDepositTxFn, escrowDepositFn, recordDepositTxFn, submitEscrowRefundFn, logger, notificationDispatcher }) {
    this.orderRepository = orderRepository;
    this.buildDepositTxFn = buildDepositTxFn || escrowDepositFn || (async () => ({ bookingId: 'mock-booking-id' }));
    this.recordDepositTxFn = recordDepositTxFn;
    this.submitEscrowRefundFn = submitEscrowRefundFn;
    this.logger = logger;
    this.notificationDispatcher = notificationDispatcher;
  }

  async acceptBid({ orderId, bidId, customerId }) {
    return measureExecution('BidAcceptanceService.acceptBid', async () => {
      const lockKey = `escrow_lock:${orderId}`;
      const lock = await acquireLockOrFallback(lockKey, 10000);
      if (!lock.ok) {
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
            this.logger?.error?.('Truck
