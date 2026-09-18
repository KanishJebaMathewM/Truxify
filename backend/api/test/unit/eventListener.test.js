import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRedis, mockSupabaseAdmin, mockSendFcm, mockAxiosPost } = vi.hoisted(() => {
  const mRedis = {
    get: vi.fn(),
    set: vi.fn(),
  };

  const mSupabaseAdmin = {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        or: vi.fn().mockResolvedValue({ data: null, error: null }),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
      select: vi.fn(() => ({
        or: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'ord-100', customer_id: 'cust-1', driver_id: 'drv-1', total_amount: '1200' },
            error: null,
          }),
        })),
      })),
    })),
  };

  return {
    mockRedis: mRedis,
    mockSupabaseAdmin: mSupabaseAdmin,
    mockSendFcm: vi.fn().mockResolvedValue({ success: true }),
    mockAxiosPost: vi.fn().mockResolvedValue({ status: 200 }),
  };
});

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: mockSupabaseAdmin,
  redisClient: mockRedis,
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendFcmNotification: mockSendFcm,
}));

vi.mock('axios', () => ({
  default: {
    post: mockAxiosPost,
  },
}));

import {
  getLastProcessedBlock,
  saveLastProcessedBlock,
  handlePaymentLockedEvent,
  handlePaymentReleasedEvent,
  handleDisputeOpenedEvent,
} from '../../src/services/blockchain/eventListener.js';

describe('eventListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getLastProcessedBlock and saveLastProcessedBlock', () => {
    it('retrieves and parses the last processed block from Redis', async () => {
      mockRedis.get.mockResolvedValue('543210');

      const block = await getLastProcessedBlock();
      expect(block).toBe(543210);
      expect(mockRedis.get).toHaveBeenCalledWith('truxify:blockchain:last_processed_block');
    });

    it('returns null when no block is saved or Redis throws an error', async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await getLastProcessedBlock()).toBeNull();

      mockRedis.get.mockRejectedValue(new Error('Redis timeout'));
      expect(await getLastProcessedBlock()).toBeNull();
    });

    it('saves the block number to Redis as a string', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await saveLastProcessedBlock(543211);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'truxify:blockchain:last_processed_block',
        '543211'
      );
    });
  });

  describe('handlePaymentLockedEvent', () => {
    it('updates orders and trips status to locked and persists block number', async () => {
      const result = await handlePaymentLockedEvent({
        bookingId: 100,
        amount: '1200',
        customer: '0xCustomerWallet',
        blockNumber: 50010,
      });

      expect(result).toEqual({
        success: true,
        event: 'PaymentLocked',
        bookingId: '100',
      });
      expect(mockSupabaseAdmin.from).toHaveBeenCalledWith('orders');
      expect(mockSupabaseAdmin.from).toHaveBeenCalledWith('trips');
      expect(mockRedis.set).toHaveBeenCalledWith(
        'truxify:blockchain:last_processed_block',
        '50010'
      );
    });
  });

  describe('handlePaymentReleasedEvent', () => {
    it('updates order/trip records and dispatches FCM notifications to customer and driver', async () => {
      const result = await handlePaymentReleasedEvent({
        bookingId: 100,
        amount: '1200',
        driver: '0xDriverWallet',
        blockNumber: 50020,
      });

      expect(result).toEqual({
        success: true,
        event: 'PaymentReleased',
        bookingId: '100',
      });
      expect(mockSendFcm).toHaveBeenCalledTimes(2); // One for customer, one for driver
      expect(mockSendFcm).toHaveBeenCalledWith(
        'cust-1',
        expect.objectContaining({ title: 'Payment Released ✓' }),
        expect.any(Object)
      );
      expect(mockSendFcm).toHaveBeenCalledWith(
        'drv-1',
        expect.objectContaining({ title: 'Payment Received 💰' }),
        expect.any(Object)
      );
    });
  });

  describe('handleDisputeOpenedEvent', () => {
    it('updates status to disputed and triggers n8n webhook when URL is set', async () => {
      process.env.N8N_DISPUTE_WEBHOOK_URL = 'https://n8n.example.com/webhook/dispute';

      const result = await handleDisputeOpenedEvent({
        bookingId: 100,
        reason: 'Cargo damaged upon delivery',
        blockNumber: 50030,
      });

      expect(result).toEqual({
        success: true,
        event: 'DisputeOpened',
        bookingId: '100',
      });
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://n8n.example.com/webhook/dispute',
        expect.objectContaining({
          event: 'DisputeOpened',
          bookingId: '100',
          reason: 'Cargo damaged upon delivery',
        }),
        expect.any(Object)
      );
      delete process.env.N8N_DISPUTE_WEBHOOK_URL;
    });
  });
});
