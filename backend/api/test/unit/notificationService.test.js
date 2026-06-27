import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseUpdateMock = vi.fn().mockResolvedValue({ error: null });
const supabaseInsertMock = vi.fn().mockResolvedValue({ error: null });
const supabaseSelectMock = vi.fn();
const firebaseSendMock = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: (fields) => ({
            eq: (col, val) => ({
              maybeSingle: () => supabaseSelectMock(table, fields, col, val)
            }),
          }),
          update: (data) => ({
            eq: (col, val) => supabaseUpdateMock(table, data, col, val)
          })
        };
      }
      if (table === 'notifications') {
        return {
          insert: (data) => supabaseInsertMock(table, data)
        };
      }
    }
  },
  firebaseAdmin: {
    messaging: () => ({
      send: firebaseSendMock
    })
  }
}));

const {
  sendDeliveryOtpNotification,
  sendPushNotification,
  sendFcmNotification,
} = await import('../../src/services/notificationService.js');

describe('notificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendDeliveryOtpNotification', () => {
    it('persists notification in DB and returns success when FCM succeeds', async () => {
      supabaseSelectMock.mockResolvedValue({
        data: { fcm_token: 'test_token_123' },
        error: null
      });

      firebaseSendMock.mockResolvedValue('msg_id_abc');

      const customerId = 'user_uuid_111';
      const orderDisplayId = '#ORD1234';
      const otp = '987654';

      const result = await sendDeliveryOtpNotification(customerId, orderDisplayId, otp);

      expect(result.success).toBe(true);
      expect(result.fcm.success).toBe(true);
      expect(result.fcm.messageId).toBe('msg_id_abc');

      expect(supabaseInsertMock).toHaveBeenCalledOnce();
      const insertArgs = supabaseInsertMock.mock.calls[0][1];
      expect(insertArgs.user_id).toBe(customerId);
      // OTP must not be stored in plaintext — body should not contain the OTP value
      expect(insertArgs.body).not.toContain(otp);
      // OTP hash is stored in metadata for audit trail
      expect(insertArgs.metadata.delivery_otp_hash).toBeDefined();
      expect(insertArgs.metadata.delivery_otp_hash).toMatch(/^[a-f0-9]{64}$/);

      expect(firebaseSendMock).toHaveBeenCalledOnce();
      const sendArgs = firebaseSendMock.mock.calls[0][0];
      expect(sendArgs.token).toBe('test_token_123');
      expect(sendArgs.notification.body).not.toContain(otp);
    });

    it('returns success false when both DB insert and FCM fail', async () => {
      supabaseSelectMock.mockResolvedValue({
        data: { fcm_token: 'test_token_123' },
        error: null
      });

      supabaseInsertMock.mockResolvedValue({ error: { message: 'DB error' } });
      const fcmError = new Error('Firebase error');
      fcmError.code = 'messaging/internal-error';
      firebaseSendMock.mockRejectedValue(fcmError);

      const result = await sendDeliveryOtpNotification('user_uuid_111', '#ORD1234', '987654');

      expect(result.success).toBe(false);
      expect(result.fcm.success).toBe(false);
    });

    it('returns no FCM token warning when user has no token', async () => {
      supabaseSelectMock.mockResolvedValue({
        data: { fcm_token: null },
        error: null
      });

      const result = await sendDeliveryOtpNotification('user_uuid_111', '#ORD1234', '987654');

      expect(result.success).toBe(false);
      expect(result.fcm.success).toBe(false);
      expect(result.fcm.error).toBe('No FCM token');
    });
  });

  describe('sendFcmNotification', () => {
    it('clears invalid/expired registration tokens on Firebase error', async () => {
      supabaseSelectMock.mockResolvedValue({
        data: { fcm_token: 'expired_token_xyz' },
        error: null
      });

      const fcmError = new Error('The registration token is not registered.');
      fcmError.code = 'messaging/registration-token-not-registered';
      firebaseSendMock.mockRejectedValue(fcmError);

      const customerId = 'user_uuid_111';

      await sendFcmNotification(customerId, { title: 'Test', body: 'Test' });

      expect(supabaseUpdateMock).toHaveBeenCalledOnce();
      const updateArgs = supabaseUpdateMock.mock.calls[0][1];
      expect(updateArgs.fcm_token).toBeNull();
      expect(updateArgs).toHaveProperty('fcm_token_updated_at');
    });
  });

  describe('sendPushNotification', () => {
    it('returns success when FCM succeeds', async () => {
      supabaseSelectMock.mockResolvedValue({
        data: { fcm_token: 'test_token_456' },
        error: null
      });

      firebaseSendMock.mockResolvedValue('msg_id_xyz');

      const result = await sendPushNotification('user_uuid_222', 'Test Title', 'Test Body', 'order_update');

      expect(result.success).toBe(true);
      expect(result.fcm.messageId).toBe('msg_id_xyz');
      expect(supabaseInsertMock).toHaveBeenCalledOnce();
    });

    it('classifies transient errors and retries', async () => {
      supabaseSelectMock.mockResolvedValue({
        data: { fcm_token: 'test_token_789' },
        error: null
      });

      const transientError = new Error('Internal error');
      transientError.code = 'messaging/internal-error';
      firebaseSendMock.mockRejectedValue(transientError);

      const result = await sendPushNotification('user_uuid_333', 'Test', 'Body', 'test');

      expect(result.success).toBe(false);
      expect(firebaseSendMock).toHaveBeenCalledTimes(3);
    });
  });
});
