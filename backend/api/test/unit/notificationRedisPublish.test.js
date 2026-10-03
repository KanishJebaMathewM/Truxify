import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedisPublish = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    })),
  },
  firebaseAdmin: null,
  redisClient: {
    publish: (...args) => mockRedisPublish(...args),
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: (...args) => mockLoggerError(...args),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  publishNotification,
  publishNotificationEvent,
  sendNotification,
} = await import('../../src/services/notificationService.js');

describe('Notification Pipeline Redis Publish Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('publishNotification', () => {
    it('successfully publishes notification payload to Redis notifications channel', async () => {
      mockRedisPublish.mockResolvedValue(1);

      const payload = {
        userId: 'user-123',
        event: 'order_update',
        orderId: 'ORD-999',
        message: 'Your driver is arriving',
      };

      const result = await publishNotification(payload);

      expect(result).toBe(true);
      expect(mockRedisPublish).toHaveBeenCalledTimes(1);
      expect(mockRedisPublish).toHaveBeenCalledWith('notifications', JSON.stringify(payload));
      expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('awaits Redis publish and logs error with logger.error on publish failure', async () => {
      const publishError = new Error('Redis connection dropped');
      mockRedisPublish.mockRejectedValue(publishError);

      const payload = {
        userId: 'user-456',
        event: 'payment_released',
        amount: 2500,
      };

      const result = await publishNotification(payload);

      expect(result).toBe(false);
      expect(mockRedisPublish).toHaveBeenCalledTimes(1);
      expect(mockRedisPublish).toHaveBeenCalledWith('notifications', JSON.stringify(payload));

      expect(mockLoggerError).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Failed to publish notification to Redis:',
        {
          error: publishError.message,
          stack: publishError.stack,
          payload,
        }
      );
    });

    it('publishNotificationEvent alias functions identically', async () => {
      mockRedisPublish.mockResolvedValue(1);

      const payload = { test: true };
      const result = await publishNotificationEvent(payload);

      expect(result).toBe(true);
      expect(mockRedisPublish).toHaveBeenCalledWith('notifications', JSON.stringify(payload));
    });
  });

  describe('sendNotification with Redis publish integration', () => {
    it('publishes payload to Redis notifications channel during sendNotification', async () => {
      mockRedisPublish.mockResolvedValue(1);

      const payload = {
        title: 'Package Delivered',
        body: 'Your shipment has arrived safely',
      };

      const results = await sendNotification('user-789', payload);

      expect(Array.isArray(results)).toBe(true);
      expect(mockRedisPublish).toHaveBeenCalledWith('notifications', JSON.stringify(payload));
      expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('catches and logs Redis publish failures without halting sendNotification execution', async () => {
      const publishError = new Error('ECONNREFUSED 127.0.0.1:6379');
      mockRedisPublish.mockRejectedValue(publishError);

      const payload = {
        title: 'Critical Alert',
        body: 'Immediate action required',
      };

      const results = await sendNotification('user-789', payload);

      expect(Array.isArray(results)).toBe(true);
      expect(mockRedisPublish).toHaveBeenCalledWith('notifications', JSON.stringify(payload));
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Failed to publish notification to Redis:',
        {
          error: publishError.message,
          stack: publishError.stack,
          payload,
        }
      );
    });
  });
});
