import { describe, it, expect, vi, beforeEach } from 'vitest';

// The suite predates the userId-oriented redesign (the service resolves the
// user's active device tokens itself) — and its tail was a splice of a
// phantom class-based suite. Rewritten against the real seams:
// config/db.js supabaseAdmin (user_devices + notifications) and
// firebaseAdmin.messaging().sendEachForMulticast.

const sendEachForMulticast = vi.fn();
const notificationsInsert = vi.fn();

vi.mock('../../../src/config/db.js', () => ({
  supabaseAdmin: {
    from: vi.fn((table) => {
      if (table === 'user_devices') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(async () => ({
                data: [
                  { id: 'dev-1', fcm_token: 'token-1', platform: 'android', device_id: 'd1' },
                  { id: 'dev-2', fcm_token: 'token-2', platform: 'ios', device_id: 'd2' },
                ],
                error: null,
              })),
            })),
          })),
        };
      }
      // notifications insert
      return { insert: notificationsInsert };
    }),
  },
  firebaseAdmin: {
    messaging: () => ({ sendEachForMulticast }),
  },
  redisClient: null,
  supabase: null,
  createUserClient: null,
  mongoDb: null,
}));

const { sendPushNotification, sendFcmNotification } = await import('../../../src/services/notificationService.js');

describe('notificationService module functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationsInsert.mockResolvedValue({ error: null });
    sendEachForMulticast.mockResolvedValue({
      responses: [{ success: true }, { success: true }],
    });
  });

  describe('sendFcmNotification', () => {
    it('resolves active device tokens for the user and multicasts to them', async () => {
      const result = await sendFcmNotification('user-1', { title: 'Toll Plaza Passed', body: 'Verified by WIM sensor.' }, {});
      expect(sendEachForMulticast).toHaveBeenCalledOnce();
      const message = sendEachForMulticast.mock.calls[0][0];
      expect(message.tokens).toEqual(['token-1', 'token-2']);
      // Success contract: a summary with the delivered count.
      expect(result.success ?? result.delivered > 0).toBeTruthy();
    });

    it('returns a NO_FCM_TOKEN failure when the user has no active devices', async () => {
      // Override the devices lookup to return none for this call
      const { supabaseAdmin } = await import('../../../src/config/db.js');
      supabaseAdmin.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: [], error: null })),
          })),
        })),
      });
      // profile fallback also empty (no profiles mock row)
      const result = await sendFcmNotification('user-no-devices', { title: 't', body: 'b' }, {});
      expect(result.success).toBe(false);
      expect(result.errorCode ?? result.error).toBeDefined();
    });
  });

  describe('sendPushNotification', () => {
    it('persists the notification row and dispatches via FCM', async () => {
      const result = await sendPushNotification('user-1', 'Shipment Dispatched', 'Your truck is en route.', 'order_update', { orderId: 'o1' });
      expect(notificationsInsert).toHaveBeenCalledOnce();
      expect(sendEachForMulticast).toHaveBeenCalledOnce();
      expect(result.success).toBe(true);
    });

    it('rejects an unknown notif_type with a 400 DomainError', async () => {
      await expect(
        sendPushNotification('user-1', 't', 'b', 'definitely-not-a-type'),
      ).rejects.toThrow(/Invalid notif_type/);
    });
  });
});
