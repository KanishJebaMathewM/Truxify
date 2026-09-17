import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ethers } from 'ethers';

import { createSupabaseMock } from '../../helpers/supabaseMock.js';
import { OrderRepository } from '../../../src/repositories/orderRepository.js';
import { BidAcceptanceService, DomainError } from '../../../src/services/order/bidAcceptanceService.js';

vi.mock('../../../src/services/escrow.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    escrowDeposit: vi.fn(),
    submitEscrowRefund: vi.fn(),
  };
});

describe('BidAcceptanceService', () => {
  let supabaseMock;
  let orderRepository;
  let service;
  let escrowDeposit;
  let submitEscrowRefund;

  beforeEach(async () => {
    supabaseMock = createSupabaseMock();
    const { escrowDeposit: escrowDepositFn, submitEscrowRefund: submitEscrowRefundFn } = await import('../../../src/services/escrow.js');
    escrowDeposit = escrowDepositFn;
    submitEscrowRefund = submitEscrowRefundFn;

    escrowDeposit.mockResolvedValue({ txData: { to: '0xcontract', data: '0xabcd' }, bookingId: 'escrow:ORDER-001' });
    submitEscrowRefund.mockResolvedValue({ txHash: '0x456' });
    escrowDeposit.mockClear();
    submitEscrowRefund.mockClear();

    orderRepository = new OrderRepository(supabaseMock.supabase);

    service = new BidAcceptanceService({
      orderRepository,
      supabase: supabaseMock.supabase,
      escrowDepositFn: escrowDeposit,
      escrowRefundFn: submitEscrowRefund,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
      notificationDispatcher: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('accepts a bid and records the escrow outcome', async () => {
    supabaseMock.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORDER-001',
      customer_id: 'customer-1',
      driver_id: null,
      vehicle_id: null,
      status: 'pending',
      version: 1,
      escrow_status: null,
      pending_bid_acceptance: null,
    }];
    supabaseMock.store.load_bids = [{
      id: 'bid-1',
      load_id: 'offer-1',
      order_id: 'order-1',
      driver_id: 'driver-1',
      version: 1,
      bid_amount: 50000,
      status: 'pending',
      created_at: '2024-01-01T00:00:00.000Z',
    }];
    supabaseMock.store.load_offers = [{
      id: 'offer-1',
      order_display_id: 'ORDER-001',
    }];
    supabaseMock.store.profiles = [
      {
        id: 'driver-1',
        full_name: 'Jane Driver',
        polygon_wallet_address: '0xdriver',
      },
      {
        id: 'customer-1',
        polygon_wallet_address: '0xcustomer',
      },
    ];
    supabaseMock.store.driver_details = [{
      user_id: 'driver-1',
      polygon_wallet_address: '0xdriver',
      rating: 4.8,
      truck_id: 'truck-1',
    }];
    supabaseMock.store.trucks = [{
      id: 'truck-1',
      name: 'Big Rig',
      number_plate: 'ABC-123',
    }];

    const result = await service.acceptBid({
      orderId: 'order-1',
      bidId: 'bid-1',
      customerId: 'customer-1',
    });

    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Bid reserved. Complete the escrow deposit to finalize the driver assignment.');
    expect(escrowDeposit).toHaveBeenCalled();

    // Verify the correct amountWei was computed using ESCROW_MATIC_PER_PAISA
    // bid_amount = 50000 paisa (₹500) converted via paisaToMaticWei
    const escrowArgs = escrowDeposit.mock.calls[0];
    const amountWei = escrowArgs[2];
    expect(typeof amountWei).toBe('bigint');
    expect(amountWei).toBe(ethers.parseEther((50000 * 0.000004).toFixed(18)));
    // Two-phase acceptance: the driver must NOT be committed at accept time.
    expect(supabaseMock.calls.some(call => call.rpc === 'accept_bid_tx')).toBe(false);

    // The pending acceptance context is persisted for confirm-deposit.
    const escrowUpdate = supabaseMock.calls.find(call => call.mode === 'update' && call.table === 'orders' && call.payload?.escrow_status === 'funding');
    expect(escrowUpdate).toBeTruthy();
    expect(escrowUpdate.payload.pending_bid_acceptance).toMatchObject({
      bid_id: 'bid-1',
      load_id: 'offer-1',
      driver_id: 'driver-1',
      truck_id: 'truck-1',
      driver_name: 'Jane Driver',
      driver_rating: 4.8,
      truck_number: 'ABC-123',
      bid_amount: 50000,
      order_display_id: 'ORDER-001',
      version: 1,
    });
  });

  it('rejects acceptance when wallets are missing', async () => {
    supabaseMock.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORDER-001',
      customer_id: 'customer-1',
      driver_id: null,
      vehicle_id: null,
      status: 'pending',
    }];
    supabaseMock.store.load_bids = [{
      id: 'bid-1',
      load_id: 'offer-1',
      order_id: 'order-1',
      driver_id: 'driver-1',
      version: 1,
      bid_amount: 50000,
      status: 'pending',
      created_at: '2024-01-01T00:00:00.000Z',
    }];
    supabaseMock.store.load_offers = [{
      id: 'offer-1',
      order_display_id: 'ORDER-001',
    }];
    supabaseMock.store.profiles = [
      {
        id: 'driver-1',
        full_name: 'Jane Driver',
        polygon_wallet_address: null,
      },
      {
        id: 'customer-1',
        polygon_wallet_address: '0xcustomer',
      },
    ];
    supabaseMock.store.driver_details = [{
      user_id: 'driver-1',
      polygon_wallet_address: null,
      rating: 4.8,
      truck_id: 'truck-1',
    }];
    supabaseMock.store.trucks = [{
      id: 'truck-1',
      name: 'Big Rig',
      number_plate: 'ABC-123',
    }];

    await expect(service.acceptBid({ orderId: 'order-1', bidId: 'bid-1', customerId: 'customer-1' })).rejects.toMatchObject({
      status: 422,
    });
  });

  it('blocks a second bid acceptance while escrow funding is in flight', async () => {
    supabaseMock.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORDER-001',
      customer_id: 'customer-1',
      driver_id: null,
      vehicle_id: null,
      status: 'pending',
      version: 1,
      escrow_status: 'funding',
      pending_bid_acceptance: {
        bid_id: 'bid-0',
        load_id: 'offer-1',
        driver_id: 'driver-2',
        version: 1,
        order_display_id: 'ORDER-001',
      },
    }];
    supabaseMock.store.load_bids = [{
      id: 'bid-1',
      load_id: 'offer-1',
      order_id: 'order-1',
      driver_id: 'driver-1',
      version: 1,
      bid_amount: 50000,
      status: 'pending',
      created_at: '2024-01-01T00:00:00.000Z',
    }];
    supabaseMock.store.load_offers = [{
      id: 'offer-1',
      order_display_id: 'ORDER-001',
    }];
    supabaseMock.store.profiles = [
      {
        id: 'driver-1',
        full_name: 'Jane Driver',
        polygon_wallet_address: '0xdriver',
      },
      {
        id: 'customer-1',
        polygon_wallet_address: '0xcustomer',
      },
    ];
    supabaseMock.store.driver_details = [{
      user_id: 'driver-1',
      polygon_wallet_address: '0xdriver',
      rating: 4.8,
      truck_id: 'truck-1',
    }];
    supabaseMock.store.trucks = [{
      id: 'truck-1',
      name: 'Big Rig',
      number_plate: 'ABC-123',
    }];

    await expect(service.acceptBid({ orderId: 'order-1', bidId: 'bid-1', customerId: 'customer-1' })).rejects.toMatchObject({
      status: 409,
    });
    expect(escrowDeposit).not.toHaveBeenCalled();
    expect(supabaseMock.calls.some(call => call.rpc === 'accept_bid_tx')).toBe(false);
  });

  it('rejects bid acceptance when buildDepositTx returns null txData (escrow not configured)', async () => {
    supabaseMock.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORDER-001',
      customer_id: 'customer-1',
      driver_id: null,
      vehicle_id: null,
      status: 'pending',
      version: 1,
    }];
    supabaseMock.store.load_bids = [{
      id: 'bid-1',
      load_id: 'offer-1',
      order_id: 'order-1',
      driver_id: 'driver-1',
      version: 1,
      bid_amount: 50000,
      status: 'pending',
      created_at: '2024-01-01T00:00:00.000Z',
    }];
    supabaseMock.store.load_offers = [{
      id: 'offer-1',
      order_display_id: 'ORDER-001',
    }];
    supabaseMock.store.profiles = [
      {
        id: 'driver-1',
        full_name: 'Jane Driver',
        polygon_wallet_address: '0xdriver',
      },
      {
        id: 'customer-1',
        polygon_wallet_address: '0xcustomer',
      },
    ];
    supabaseMock.store.driver_details = [{
      user_id: 'driver-1',
      polygon_wallet_address: '0xdriver',
      rating: 4.8,
      truck_id: 'truck-1',
    }];
    supabaseMock.store.trucks = [{
      id: 'truck-1',
      name: 'Big Rig',
      number_plate: 'ABC-123',
    }];

    // Override the deposit mock to return null txData (simulating escrow not configured)
    escrowDeposit.mockResolvedValue({ txData: null, bookingId: 'escrow:ORDER-001' });

    await expect(service.acceptBid({ orderId: 'order-1', bidId: 'bid-1', customerId: 'customer-1' })).rejects.toMatchObject({
      status: 502,
    });
  });

  it('rejects a second bid acceptance after the escrow is already funded', async () => {
    supabaseMock.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORDER-001',
      customer_id: 'customer-1',
      driver_id: 'driver-1',
      vehicle_id: 'truck-1',
      status: 'active',
      version: 2,
      escrow_status: 'funded',
      pending_bid_acceptance: null,
      escrow_booking_id: 'escrow:ORDER-001',
    }];
    supabaseMock.store.load_bids = [{
      id: 'bid-1',
      load_id: 'offer-1',
      order_id: 'order-1',
      driver_id: 'driver-1',
      version: 1,
      bid_amount: 50000,
      status: 'pending',
      created_at: '2024-01-01T00:00:00.000Z',
    }];
    supabaseMock.store.load_offers = [{
      id: 'offer-1',
      order_display_id: 'ORDER-001',
    }];
    supabaseMock.store.profiles = [
      {
        id: 'driver-1',
        full_name: 'Jane Driver',
        polygon_wallet_address: '0xdriver',
      },
      {
        id: 'customer-1',
        polygon_wallet_address: '0xcustomer',
      },
    ];
    supabaseMock.store.driver_details = [{
      user_id: 'driver-1',
      polygon_wallet_address: '0xdriver',
      rating: 4.8,
      truck_id: 'truck-1',
    }];
    supabaseMock.store.trucks = [{
      id: 'truck-1',
      name: 'Big Rig',
      number_plate: 'ABC-123',
    }];

    await expect(service.acceptBid({ orderId: 'order-1', bidId: 'bid-1', customerId: 'customer-1' })).rejects.toMatchObject({
      status: 409,
    });

    // The guard must fire before any mutation: no deposit tx is built and the
    // funded booking reference is left untouched.
    expect(escrowDeposit).not.toHaveBeenCalled();
    expect(supabaseMock.store.orders[0].escrow_status).toBe('funded');
    expect(supabaseMock.store.orders[0].escrow_booking_id).toBe('escrow:ORDER-001');
  });

  it('rejects bid acceptance after the escrow has been released', async () => {
    supabaseMock.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORDER-001',
      customer_id: 'customer-1',
      driver_id: 'driver-1',
      vehicle_id: 'truck-1',
      status: 'payment_released',
      version: 2,
      escrow_status: 'released',
      pending_bid_acceptance: null,
      escrow_booking_id: 'escrow:ORDER-001',
    }];
    supabaseMock.store.load_bids = [{
      id: 'bid-1',
      load_id: 'offer-1',
      order_id: 'order-1',
      driver_id: 'driver-1',
      version: 1,
      bid_amount: 50000,
      status: 'pending',
      created_at: '2024-01-01T00:00:00.000Z',
    }];
    supabaseMock.store.load_offers = [{
      id: 'offer-1',
      order_display_id: 'ORDER-001',
    }];
    supabaseMock.store.profiles = [
      {
        id: 'driver-1',
        full_name: 'Jane Driver',
        polygon_wallet_address: '0xdriver',
      },
      {
        id: 'customer-1',
        polygon_wallet_address: '0xcustomer',
      },
    ];
    supabaseMock.store.driver_details = [{
      user_id: 'driver-1',
      polygon_wallet_address: '0xdriver',
      rating: 4.8,
      truck_id: 'truck-1',
    }];
    supabaseMock.store.trucks = [{
      id: 'truck-1',
      name: 'Big Rig',
      number_plate: 'ABC-123',
    }];

    await expect(service.acceptBid({ orderId: 'order-1', bidId: 'bid-1', customerId: 'customer-1' })).rejects.toMatchObject({
      status: 409,
    });
    expect(escrowDeposit).not.toHaveBeenCalled();
    expect(supabaseMock.store.orders[0].escrow_status).toBe('released');
  });

  it('rejects bid acceptance when the order is in a terminal state', async () => {
    supabaseMock.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORDER-001',
      customer_id: 'customer-1',
      driver_id: null,
      vehicle_id: null,
      status: 'cancelled',
      version: 1,
      escrow_status: 'pending',
      pending_bid_acceptance: null,
    }];
    supabaseMock.store.load_bids = [{
      id: 'bid-1',
      load_id: 'offer-1',
      order_id: 'order-1',
      driver_id: 'driver-1',
      version: 1,
      bid_amount: 50000,
      status: 'pending',
      created_at: '2024-01-01T00:00:00.000Z',
    }];
    supabaseMock.store.load_offers = [{
      id: 'offer-1',
      order_display_id: 'ORDER-001',
    }];
    supabaseMock.store.profiles = [
      {
        id: 'driver-1',
        full_name: 'Jane Driver',
        polygon_wallet_address: '0xdriver',
      },
      {
        id: 'customer-1',
        polygon_wallet_address: '0xcustomer',
      },
    ];
    supabaseMock.store.driver_details = [{
      user_id: 'driver-1',
      polygon_wallet_address: '0xdriver',
      rating: 4.8,
      truck_id: 'truck-1',
    }];
    supabaseMock.store.trucks = [{
      id: 'truck-1',
      name: 'Big Rig',
      number_plate: 'ABC-123',
    }];

    await expect(service.acceptBid({ orderId: 'order-1', bidId: 'bid-1', customerId: 'customer-1' })).rejects.toMatchObject({
      status: 409,
    });
    expect(escrowDeposit).not.toHaveBeenCalled();
  });

  it('rejects a concurrent double-accept that already reserved a bid', async () => {
    // Simulates the loser of a TOCTOU race: another acceptBid already wrote
    // pending_bid_acceptance, but this request re-read a stale order with
    // escrow_status still 'pending'. The conditional UPDATE must match no row
    // (pending_bid_acceptance is no longer null) instead of overwriting it.
    supabaseMock.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORDER-001',
      customer_id: 'customer-1',
      driver_id: null,
      vehicle_id: null,
      status: 'pending',
      version: 1,
      escrow_status: 'pending',
      pending_bid_acceptance: {
        bid_id: 'bid-0',
        load_id: 'offer-1',
        driver_id: 'driver-2',
        version: 1,
        order_display_id: 'ORDER-001',
      },
    }];
    supabaseMock.store.load_bids = [{
      id: 'bid-1',
      load_id: 'offer-1',
      order_id: 'order-1',
      driver_id: 'driver-1',
      version: 1,
      bid_amount: 50000,
      status: 'pending',
      created_at: '2024-01-01T00:00:00.000Z',
    }];
    supabaseMock.store.load_offers = [{
      id: 'offer-1',
      order_display_id: 'ORDER-001',
    }];
    supabaseMock.store.profiles = [
      {
        id: 'driver-1',
        full_name: 'Jane Driver',
        polygon_wallet_address: '0xdriver',
      },
      {
        id: 'customer-1',
        polygon_wallet_address: '0xcustomer',
      },
    ];
    supabaseMock.store.driver_details = [{
      user_id: 'driver-1',
      polygon_wallet_address: '0xdriver',
      rating: 4.8,
      truck_id: 'truck-1',
    }];
    supabaseMock.store.trucks = [{
      id: 'truck-1',
      name: 'Big Rig',
      number_plate: 'ABC-123',
    }];

    await expect(service.acceptBid({ orderId: 'order-1', bidId: 'bid-1', customerId: 'customer-1' })).rejects.toMatchObject({
      status: 409,
    });

    // The existing acceptance must not be overwritten.
    expect(supabaseMock.store.orders[0].pending_bid_acceptance).toMatchObject({ bid_id: 'bid-0' });
    expect(supabaseMock.store.orders[0].escrow_status).toBe('pending');
    expect(supabaseMock.calls.some(call => call.rpc === 'accept_bid_tx')).toBe(false);
  });
});
