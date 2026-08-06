import { describe, it, expect, vi, beforeEach } from 'vitest';
import notificationService, { sendDeliveryOtpNotification } from '../../src/services/notificationService.js';
import DomainError from '../../src/errors/DomainError.js';

describe('notificationService allowlist validation', () => {
  it('should throw DomainError for invalid notif_type in insertNotification', async () => {
    const invalidData = { notif_type: 'invalid_type', user_id: '123' };
    await expect(notificationService.insertNotification(invalidData)).rejects.toThrow(DomainError);
  });

  it('should throw DomainError for invalid notif_type in sendPushNotification', async () => {
    const invalidPayload = { notif_type: 'unsupported_type', title: 'Test' };
    await expect(notificationService.sendPushNotification(invalidPayload)).rejects.toThrow(DomainError);
  });

  it('should allow valid notif_types', async () => {
    for (const type of ['order_update', 'payment', 'load_offer', 'trip_update', 'document', 'system']) {
      const payload = { notif_type: type, title: 'Test' };
      // Will attempt supabase call, which might fail or resolve depending on mock, but won't throw DomainError
      await expect(notificationService.sendPushNotification(payload)).resolves.toBeDefined();
    }
  });
});

describe('sendDeliveryOtpNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined and callable with valid arguments', async () => {
    const customerId = 'cust-123';
    const orderDisplayId = 'ORD-001';
    const otp = '123456';

    // The function should not throw when called with valid arguments.
    // It may resolve to an object or throw if external calls fail,
    // but it should be callable without TypeErrors.
    await expect(sendDeliveryOtpNotification(customerId, orderDisplayId, otp)).resolves.toBeDefined();
  });

  it('should accept string customerId and numeric OTP', async () => {
    await expect(
      sendDeliveryOtpNotification('user-abc', 'ORD-999', 654321)
    ).resolves.toBeDefined();
  });
});
