import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const supabaseUpdateMock = vi.fn().mockResolvedValue({ error: null });
const supabaseInsertMock = vi.fn().mockResolvedValue({ error: null });
const supabaseSelectMock = vi.fn();
const firebaseSendMock = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: table => {
      if (table === 'profiles') {
        return {
          select: fields => ({
            eq: (col, val) => ({
              maybeSingle: () => supabaseSelectMock(table, fields, col, val)
            })
          }),
          update: data => ({
            eq: (col, val) => supabaseUpdateMock(table, data, col, val)
          })
        };
      }
      if (table === 'notifications') {
        return {
          insert: data => supabaseInsertMock(table, data)
        };
      }
      if (table === 'delivery_otps') {
        return {
          update: data => ({
            eq: (col, val) => ({
              eq: (col2, val2) => ({
                select: fields => ({
                  maybeSingle: () => supabaseUpdateMock(table, data, col, val, col2, val2, fields)
                })
              })
            })
          })
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
  verifyDeliveryOtp,
  hashDeliveryOtp,
  verifyDeliveryOtpHash
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
      // OTP is NOT included in the notification body (security fix)
      expect(insertArgs.body).not.toContain(otp);
      expect(insertArgs.body).toContain(orderDisplayId);
      // No OTP-derived value (not even a brute-forceable digest) is persisted
      expect(insertArgs.metadata).not.toHaveProperty('delivery_otp_hash');
      expect(insertArgs.metadata.order_display_id).toBe(orderDisplayId);

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

  describe('verifyDeliveryOtp', () => {
    it('marks a specific OTP record as verified by ID', async () => {
      supabaseUpdateMock.mockResolvedValue({
        data: { id: 'otp-uuid-123' },
        error: null
      });

      const result = await verifyDeliveryOtp('otp-uuid-123');

      expect(result).toBe(true);
      expect(supabaseUpdateMock).toHaveBeenCalledOnce();

      const [table, data, col, val] = supabaseUpdateMock.mock.calls[0];
      expect(table).toBe('delivery_otps');
      expect(data.verified).toBe(true);
      expect(data.verified_at).toBeDefined();
      expect(col).toBe('id');
      expect(val).toBe('otp-uuid-123');
    });

    it('returns false when Supabase update fails', async () => {
      supabaseUpdateMock.mockResolvedValue({
        data: null,
        error: { message: 'DB error' }
      });

      const result = await verifyDeliveryOtp('otp-uuid-123');
      expect(result).toBe(false);
    });

    it('returns false when no OTP record is found or already verified', async () => {
      supabaseUpdateMock.mockResolvedValue({
        data: null,
        error: null
      });

      const result = await verifyDeliveryOtp('nonexistent-otp-id');
      expect(result).toBe(false);
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

  describe('hashDeliveryOtp / verifyDeliveryOtpHash', () => {
    it('round-trips a salted scrypt digest', () => {
      const { hash, salt } = hashDeliveryOtp('123456');
      expect(hash).toMatch(/^[a-f0-9]{128}$/);
      expect(salt).toMatch(/^[a-f0-9]{32}$/);
      expect(salt).not.toBe(hash);

      expect(verifyDeliveryOtpHash('123456', { otp_hash: hash, otp_salt: salt })).toBe(true);
      expect(verifyDeliveryOtpHash('654321', { otp_hash: hash, otp_salt: salt })).toBe(false);
    });

    it('is deterministic for a fixed salt', () => {
      const salt = 'a'.repeat(32);
      const first = hashDeliveryOtp('123456', salt);
      const second = hashDeliveryOtp('123456', salt);
      expect(first).toEqual(second);
      expect(first.salt).toBe(salt);
    });

    it('accepts pre-migration unsalted SHA-256 hashes', () => {
      const legacyHash = crypto.createHash('sha256').update('123456').digest('hex');
      expect(verifyDeliveryOtpHash('123456', { otp_hash: legacyHash })).toBe(true);
      expect(verifyDeliveryOtpHash('654321', { otp_hash: legacyHash })).toBe(false);
    });

    it('rejects null, malformed, or unknown records', () => {
      expect(verifyDeliveryOtpHash('123456', null)).toBe(false);
      expect(verifyDeliveryOtpHash('123456', {})).toBe(false);
      expect(
        verifyDeliveryOtpHash('123456', {
          otp_hash: 'zz'.repeat(64),
          otp_salt: 'a'.repeat(32)
        })
      ).toBe(false);
      expect(
        verifyDeliveryOtpHash('123456', {
          otp_hash: 'not-hex',
          otp_salt: 'a'.repeat(32)
        })
      ).toBe(false);
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
