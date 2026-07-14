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
    escrowRefund: vi.fn(),
  };
});

describe('BidAcceptanceService', () => {
  let supabaseMock;
  let orderRepository;
  let service;
  let escrowDeposit;
  let escrowRefund;

  beforeEach(async () => {
    supabaseMock = createSupabaseMock();
    const { escrowDeposit: escrowDepositFn, escrowRefund: escrowRefundFn } = await import('../../../src/services/escrow.js');
    escrowDeposit = escrowDepositFn;
    escrowRefund = escrowRefundFn;

    escrowDeposit.mockResolvedValue({ txData: { to: '0xcontract', data: '0xabcd' }, bookingId: 'escrow:ORDER-001' });
    escrowRefund.mockResolvedValue({ txHash: '0x456' });

    orderRepository = new OrderRepository(supabaseMock.supabase);

    service = new BidAcceptanceService({
      orderRepository,
      escrowDepositFn: escrowDeposit,
      escrowRefundFn: escrowRefund,
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
    }];
    supabaseMock.store.load_bids = [{
      id: 'bid-1',
      load_id: 'offer-1',
      order_id: 'order-1',
      driver_id: 'driver-1',
      bid_amount: 250000,
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
    expect(result.body.message).toBe('Bid accepted. Driver and truck assigned.');
    expect(escrowDeposit).toHaveBeenCalled();

    // Verify the correct amountWei was computed using ESCROW_MATIC_PER_PAISA
    // bid_amount = 250000 paisa (₹2500), rate = 0.01 MATIC/paisa => 2500 MATIC
    const escrowArgs = escrowDeposit.mock.calls[0];
    const amountWei = escrowArgs[3];
    expect(typeof amountWei).toBe('bigint');
    expect(amountWei).toBe(ethers.parseEther('2500'));

    expect(supabaseMock.calls.some(call => call.rpc === 'accept_bid_tx')).toBe(true);
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
      bid_amount: 250000,
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

  it('continues when the notification dispatcher throws', async () => {
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
      bid_amount: 250000,
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

    const brokenDispatcher = vi.fn().mockRejectedValue(new Error('boom'));
    const orderRepository = new OrderRepository(supabaseMock.supabase);
    const serviceWithBrokenNotifications = new BidAcceptanceService({
      orderRepository,
      escrowDepositFn: escrowDeposit,
      escrowRefundFn: escrowRefund,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
      notificationDispatcher: brokenDispatcher,
    });

    const result = await serviceWithBrokenNotifications.acceptBid({
      orderId: 'order-1',
      bidId: 'bid-1',
      customerId: 'customer-1',
    });

    expect(result.status).toBe(200);
    expect(brokenDispatcher).toHaveBeenCalled();
  });

  it('rejects bid acceptance when buildDepositTx returns null txData (escrow not configured)', async () => {
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
      bid_amount: 250000,
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
});
