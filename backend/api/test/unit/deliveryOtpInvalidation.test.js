import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, insert } = vi.hoisted(() => ({
  state: { updateError: null, otp: null, expiresAfter: null },
  insert: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: {
    from: () => ({
      update: () => {
        const query = {
          eq: () => query,
          gt: (_column, value) => { state.expiresAfter = value; return query; },
          select: () => ({
            maybeSingle: async () => ({
              data: state.otp && Date.parse(state.otp.expires_at) > Date.parse(state.expiresAfter)
                ? { id: state.otp.id }
                : null,
              error: state.updateError,
            }),
          }),
          then: (resolve) => resolve({ error: state.updateError }),
        };
        return query;
      },
      insert,
    }),
  },
  firebaseAdmin: null,
  redisClient: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, operation) => operation(),
}));

import { expireDeliveryOtps, storeDeliveryOtp, verifyDeliveryOtp } from '../../src/services/notificationService.js';

describe('delivery OTP invalidation failures', () => {
  beforeEach(() => {
    state.updateError = null;
    state.otp = null;
    state.expiresAfter = null;
    insert.mockReset();
  });

  it('refuses to insert a replacement if prior codes could not be invalidated', async () => {
    state.updateError = { message: 'database update failed' };

    await expect(storeDeliveryOtp('order-1', '123456')).resolves.toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it('reports expiration failure so resends can fail closed', async () => {
    state.updateError = { message: 'database update failed' };

    await expect(expireDeliveryOtps('order-1')).resolves.toBe(false);
  });

  it('reports successful expiration', async () => {
    await expect(expireDeliveryOtps('order-1')).resolves.toBe(true);
  });

  it('rejects an expired OTP even when its record ID is known', async () => {
    state.otp = { id: 'old-otp', expires_at: '2020-01-01T00:00:00.000Z' };

    await expect(verifyDeliveryOtp('old-otp')).resolves.toBe(false);
    expect(state.expiresAfter).toBeTruthy();
  });

  it('still verifies a currently active OTP', async () => {
    state.otp = { id: 'new-otp', expires_at: '2099-01-01T00:00:00.000Z' };

    await expect(verifyDeliveryOtp('new-otp')).resolves.toBe(true);
  });
});
