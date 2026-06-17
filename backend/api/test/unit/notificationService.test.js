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
  sendFcmNotification
} = await import('../../src/services/notificationService.js');

describe('notificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendDeliveryOtpNotification', () => {
    it('persists notification in DB and triggers FCM push without raw OTP', async () => {
      // Mock profiles query to return a token
      supabaseSelectMock.mockResolvedValue({
        data: { fcm_token: 'test_token_123' },
        error: null
      });

      firebaseSendMock.mockResolvedValue('msg_id_abc');

      const customerId = 'user_uuid_111';
      const orderDisplayId = '#ORD1234';
      const otp = '987654';

      await sendDeliveryOtpNotification(customerId, orderDisplayId, otp);

      // Verify DB persistence of full message (including OTP)
      expect(supabaseInsertMock).toHaveBeenCalledOnce();
      // Arg 0 is table name 'notifications', Arg 1 is data payload
      const insertArgs = supabaseInsertMock.mock.calls[0][1];
      expect(insertArgs.user_id).toBe(customerId);
      expect(insertArgs.body).toContain(otp);

      // Wait a tiny bit for fire-and-forget FCM push to run
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Verify FCM push contains order ID but NOT the raw OTP
      expect(firebaseSendMock).toHaveBeenCalledOnce();
      const sendArgs = firebaseSendMock.mock.calls[0][0];
      expect(sendArgs.token).toBe('test_token_123');
      expect(sendArgs.notification.body).toContain(orderDisplayId);
      expect(sendArgs.notification.body).not.toContain(otp);
    });
  });

  describe('sendFcmNotification', () => {
    it('clears invalid/expired registration tokens on Firebase error', async () => {
      // Mock profiles query to return a token
      supabaseSelectMock.mockResolvedValue({
        data: { fcm_token: 'expired_token_xyz' },
        error: null
      });

      // Firebase throws a terminal registration error
      const fcmError = new Error('The registration token is not registered.');
      fcmError.code = 'messaging/registration-token-not-registered';
      firebaseSendMock.mockRejectedValue(fcmError);

      const customerId = 'user_uuid_111';

      await sendFcmNotification(customerId, { title: 'Test', body: 'Test' });

      // Verify that database profile was updated to clear fcm_token
      expect(supabaseUpdateMock).toHaveBeenCalledOnce();
      // Arg 1 is the updated payload
      const updateArgs = supabaseUpdateMock.mock.calls[0][1];
      expect(updateArgs.fcm_token).toBeNull();
      expect(updateArgs).toHaveProperty('fcm_token_updated_at');
    });
  });
});
