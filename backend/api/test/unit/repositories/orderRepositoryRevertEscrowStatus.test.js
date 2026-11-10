import { beforeEach, describe, expect, it } from 'vitest';

import { createSupabaseMock } from '../../helpers/supabaseMock.js';
import { OrderRepository } from '../../../src/repositories/orderRepository.js';

// Mirrors ESCROW_RESET_GUARD_FILTERS in services/order/bidAcceptanceService.js:
// acceptBid only (re-)reserves an order whose escrow is untouched/pending AND
// whose pending_bid_acceptance IS NULL.
const ACCEPT_BID_RESERVATION_GUARD = [
  { op: 'or', value: 'escrow_status.is.null,escrow_status.eq.pending' },
  { op: 'is', column: 'pending_bid_acceptance', value: null },
];

function pendingBid(bidId) {
  return {
    bid_id: bidId,
    load_id: 'load-1',
    driver_id: 'driver-1',
    truck_id: 'truck-1',
    driver_name: 'Test Driver',
    driver_rating: 4.5,
    truck_number: 'KA01AB1234',
    bid_amount: 5000,
    order_display_id: '#FF20260701',
    version: 3,
  };
}

function fundingOrder(overrides = {}) {
  return {
    id: 'order-1',
    escrow_status: 'funding',
    escrow_booking_id: '0xbooking',
    pending_bid_acceptance: pendingBid('bid-1'),
    escrow_funding_started_at: '2026-07-01T10:00:00.000Z',
    escrow_funding_attempts: 2,
    escrow_funding_last_attempt_at: '2026-07-01T10:05:00.000Z',
    escrow_funding_error: 'escrow refund pending: rpc timeout',
    ...overrides,
  };
}

describe('OrderRepository.revertEscrowStatus releases the whole bid reservation', () => {
  let supabaseMock;
  let orderRepository;

  beforeEach(() => {
    supabaseMock = createSupabaseMock();
    orderRepository = new OrderRepository(supabaseMock.supabase);
  });

  it('clears pending_bid_acceptance together with the escrow flag and funding bookkeeping', async () => {
    supabaseMock.store.orders = [fundingOrder()];

    const { error } = await orderRepository.revertEscrowStatus('order-1');

    expect(error).toBeNull();
    expect(supabaseMock.store.orders[0]).toMatchObject({
      escrow_status: 'pending',
      escrow_booking_id: null,
      pending_bid_acceptance: null,
      escrow_funding_started_at: null,
      escrow_funding_attempts: 0,
      escrow_funding_last_attempt_at: null,
      escrow_funding_error: null,
    });
  });

  it('also releases the reservation of an order that had already reached funded', async () => {
    supabaseMock.store.orders = [fundingOrder({ escrow_status: 'funded' })];

    await orderRepository.revertEscrowStatus('order-1');

    expect(supabaseMock.store.orders[0].escrow_status).toBe('pending');
    expect(supabaseMock.store.orders[0].pending_bid_acceptance).toBeNull();
  });

  it('lets the customer accept another bid after the failed deposit was refunded', async () => {
    supabaseMock.store.orders = [
      { id: 'order-1', escrow_status: null, escrow_booking_id: null, pending_bid_acceptance: null },
    ];
    const reserve = (bidId) => orderRepository.updateEscrowBooking(
      'order-1',
      '0xbooking',
      'funding',
      { pending_bid_acceptance: pendingBid(bidId) },
      ACCEPT_BID_RESERVATION_GUARD,
    );

    const first = await reserve('bid-1');
    expect(first.error).toBeNull();
    expect(first.data.escrow_status).toBe('funding');

    // accept_bid_tx fails after the lock, the refund is confirmed on-chain,
    // and the order is reverted so the customer can try again.
    await orderRepository.revertEscrowStatus('order-1');

    const second = await reserve('bid-2');
    expect(second.error).toBeNull();
    expect(second.data.pending_bid_acceptance.bid_id).toBe('bid-2');
  });

  it('still rejects a concurrent second acceptance while a reservation is in flight', async () => {
    supabaseMock.store.orders = [
      { id: 'order-1', escrow_status: null, escrow_booking_id: null, pending_bid_acceptance: null },
    ];
    const reserve = (bidId) => orderRepository.updateEscrowBooking(
      'order-1',
      '0xbooking',
      'funding',
      { pending_bid_acceptance: pendingBid(bidId) },
      ACCEPT_BID_RESERVATION_GUARD,
    );

    expect((await reserve('bid-1')).error).toBeNull();

    const second = await reserve('bid-2');
    expect(second.error?.code).toBe('PGRST116');
    expect(supabaseMock.store.orders[0].pending_bid_acceptance.bid_id).toBe('bid-1');
  });

  it('never touches orders that already moved into a refund state', async () => {
    const refundPending = fundingOrder({ id: 'order-2', escrow_status: 'refund_pending' });
    supabaseMock.store.orders = [refundPending];

    await orderRepository.revertEscrowStatus('order-2');

    expect(supabaseMock.store.orders[0].escrow_status).toBe('refund_pending');
    expect(supabaseMock.store.orders[0].pending_bid_acceptance).toEqual(pendingBid('bid-1'));
    expect(supabaseMock.store.orders[0].escrow_booking_id).toBe('0xbooking');
  });
});
