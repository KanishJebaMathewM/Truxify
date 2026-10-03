import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

let mockRedisStore = {};
let mockOrderData = {
  id: 'ord-chain-101',
  order_display_id: 'TX-101',
  customer_id: 'cust-user-1',
  driver_id: 'driver-user-1',
  total_amount: 15000,
  payment_status: 'pending',
  escrow_status: 'funded',
};

let mockTripData = {
  id: 'trip-chain-101',
  trip_display_id: 'TX-101',
  payment_status: 'pending',
  status: 'active',
};

let mockOrderUpdateError = null;
let mockOrderSelectError = null;
let mockTripUpdateError = null;
let fcmCalls = [];
let n8nCalls = [];

vi.mock('axios');

vi.mock('../../src/config/db.js', () => {
  const mockFrom = (table) => {
    if (table === 'orders') {
      return {
        update: (data) => ({
          or: (condition) => {
            if (mockOrderUpdateError) {
              return Promise.resolve({ data: null, error: mockOrderUpdateError });
            }
            Object.assign(mockOrderData, data);
            return Promise.resolve({ data: mockOrderData, error: null });
          },
          eq: (field, val) => {
            if (mockOrderUpdateError) {
              return Promise.resolve({ data: null, error: mockOrderUpdateError });
            }
            Object.assign(mockOrderData, data);
            return Promise.resolve({ data: mockOrderData, error: null });
          },
        }),
        select: () => ({
          or: () => ({
            maybeSingle: () => {
              if (mockOrderSelectError) {
                return Promise.resolve({ data: null, error: mockOrderSelectError });
              }
              return Promise.resolve({ data: mockOrderData, error: null });
            },
          }),
        }),
      };
    }
    if (table === 'trips') {
      return {
        update: (data) => ({
          or: (condition) => {
            if (mockTripUpdateError) {
              return Promise.resolve({ data: null, error: mockTripUpdateError });
            }
            Object.assign(mockTripData, data);
            return Promise.resolve({ data: mockTripData, error: null });
          },
        }),
      };
    }
    return {};
  };

  return {
    supabase: null,
    supabaseAdmin: {
      from: mockFrom,
    },
    redisClient: {
      get: (key) => Promise.resolve(mockRedisStore[key] || null),
      set: (key, val) => {
        mockRedisStore[key] = val;
        return Promise.resolve('OK');
      },
    },
    firebaseAdmin: {
      messaging: () => ({
        send: (msg) => {
          fcmCalls.push(msg);
          return Promise.resolve('mock-msg-id-123');
        },
      }),
    },
  };
});

import {
  handlePaymentLockedEvent,
  handlePaymentReleasedEvent,
  handleDisputeOpenedEvent,
  enqueueLiveEvent,
  saveLastProcessedBlock,
  getLastProcessedBlock,
} from '../../src/services/blockchain/eventListener.js';

describe('Polygon Smart Contract Event Listener Service', () => {
  beforeEach(() => {
    mockRedisStore = {};
    mockOrderUpdateError = null;
    mockOrderSelectError = null;
    mockTripUpdateError = null;
    fcmCalls = [];
    n8nCalls = [];
    mockOrderData.payment_status = 'pending';
    mockOrderData.escrow_status = 'funded';
    mockTripData.payment_status = 'pending';
    mockTripData.status = 'active';
    process.env.N8N_DISPUTE_WEBHOOK_URL = 'https://n8n.truxify.com/webhook/dispute-resolution';

    vi.mocked(axios.post).mockImplementation((url, data) => {
      n8nCalls.push({ url, data });
      return Promise.resolve({ status: 200, data: { success: true } });
    });
  });

  it('should save and get last processed block number from Redis', async () => {
    await saveLastProcessedBlock(45091234);
    const retrievedBlock = await getLastProcessedBlock();
    expect(retrievedBlock).toBe(45091234);
  });

  it('should handle PaymentLocked event and update DB paymentStatus to locked', async () => {
    const result = await handlePaymentLockedEvent({
      bookingId: 'TX-101',
      amount: '15000',
      customer: '0x1234567890abcdef',
      blockNumber: 45091235,
    });

    expect(result.success).toBe(true);
    expect(result.event).toBe('PaymentLocked');
    expect(mockOrderData.payment_status).toBe('locked');
    expect(mockOrderData.escrow_status).toBe('locked');
    expect(mockTripData.payment_status).toBe('locked');
    expect(await getLastProcessedBlock()).toBe(45091235);
  });

  it('should not advance the cursor when PaymentLocked database synchronization fails', async () => {
    mockTripUpdateError = { message: 'trip update failed' };

    const result = await handlePaymentLockedEvent({
      bookingId: 'TX-101',
      amount: '15000',
      customer: '0x1234567890abcdef',
      blockNumber: 45091235,
    });

    expect(result.success).toBe(false);
    expect(mockOrderData.payment_status).toBe('locked');
    expect(mockTripData.payment_status).toBe('pending');
    expect(await getLastProcessedBlock()).toBeNull();
  });

  it('should serialize live events in enqueue order', async () => {
    const processingOrder = [];
    let activeHandlers = 0;
    let maxConcurrentHandlers = 0;

    const createHandler = (name, delayMs) => async () => {
      activeHandlers += 1;
      maxConcurrentHandlers = Math.max(maxConcurrentHandlers, activeHandlers);
      processingOrder.push(`${name}:start`);

      await new Promise((resolve) => setTimeout(resolve, delayMs));

      processingOrder.push(`${name}:end`);
      activeHandlers -= 1;
    };

    const first = enqueueLiveEvent(createHandler('first', 20), {});
    const second = enqueueLiveEvent(createHandler('second', 1), {});
    const third = enqueueLiveEvent(createHandler('third', 1), {});

    await Promise.all([first, second, third]);

    expect(processingOrder).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
      'third:start',
      'third:end',
    ]);
    expect(maxConcurrentHandlers).toBe(1);
  });

  it('should continue processing queued live events after a handler failure', async () => {
    const processingOrder = [];

    const failing = enqueueLiveEvent(async () => {
      processingOrder.push('failed:start');
      throw new Error('simulated live event failure');
    }, {});

    const succeeding = enqueueLiveEvent(async () => {
      processingOrder.push('second:start');
    }, {});

    await Promise.all([failing, succeeding]);

    expect(processingOrder).toEqual(['failed:start', 'second:start']);
  });

  it('should handle PaymentReleased event, update DB, and send FCM push notifications to driver & customer', async () => {
    const result = await handlePaymentReleasedEvent({
      bookingId: 'TX-101',
      amount: '15000',
      driver: '0x9876543210fedcba',
      blockNumber: 45091236,
    });

    expect(result.success).toBe(true);
    expect(result.event).toBe('PaymentReleased');
    expect(mockOrderData.payment_status).toBe('released');
    expect(mockOrderData.escrow_status).toBe('payment_released');
    expect(mockTripData.payment_status).toBe('released');
    expect(mockTripData.status).toBe('completed');
    expect(await getLastProcessedBlock()).toBe(45091236);
  });

  it('should not advance the cursor when PaymentReleased database synchronization fails', async () => {
    mockOrderUpdateError = { message: 'order update failed' };

    const result = await handlePaymentReleasedEvent({
      bookingId: 'TX-101',
      amount: '15000',
      driver: '0x9876543210fedcba',
      blockNumber: 45091236,
    });

    expect(result.success).toBe(false);
    expect(mockTripData.payment_status).toBe('pending');
    expect(fcmCalls).toHaveLength(0);
    expect(await getLastProcessedBlock()).toBeNull();
  });

  it('should handle DisputeOpened event, update DB to disputed, and fire n8n dispute webhook', async () => {
    const result = await handleDisputeOpenedEvent({
      bookingId: 'TX-101',
      reason: 'Damaged goods upon unloading',
      blockNumber: 45091237,
    });

    expect(result.success).toBe(true);
    expect(result.event).toBe('DisputeOpened');
    expect(mockOrderData.payment_status).toBe('disputed');
    expect(mockOrderData.escrow_status).toBe('disputed');
    expect(mockTripData.payment_status).toBe('disputed');
    expect(n8nCalls.length).toBe(1);
    expect(n8nCalls[0].url).toBe('https://n8n.truxify.com/webhook/dispute-resolution');
    expect(n8nCalls[0].data.event).toBe('DisputeOpened');
    expect(n8nCalls[0].data.bookingId).toBe('TX-101');
    expect(await getLastProcessedBlock()).toBe(45091237);
  });

  it('should not advance the cursor when DisputeOpened database synchronization fails', async () => {
    mockOrderUpdateError = { message: 'order update failed' };

    const result = await handleDisputeOpenedEvent({
      bookingId: 'TX-101',
      reason: 'Damaged goods upon unloading',
      blockNumber: 45091237,
    });

    expect(result.success).toBe(false);
    expect(n8nCalls).toHaveLength(0);
    expect(await getLastProcessedBlock()).toBeNull();
  });
});
