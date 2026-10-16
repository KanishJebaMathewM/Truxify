import { describe, it, expect, afterEach, vi } from 'vitest';
import { verifyDeliveryOtp } from '../../src/routes/tripRoutes.js';

vi.mock('../../src/config/db.js', () => ({
  supabase: {},
  supabaseAdmin: {},
  firebaseAdmin: null,
  createUserClient: null,
}));

afterEach(() => {
  process.env.NODE_ENV = 'test';
});

describe('verifyDeliveryOtp (trip confirm-stop OTP hardening)', () => {
  it('accepts the exact configured OTP when the order has one', () => {
    expect(
      verifyDeliveryOtp({ expectedOtp: '654321', submittedOtp: '654321' }),
    ).toBe(true);
  });

  it('rejects the demo OTP (123456) when the order has its own delivery OTP configured', () => {
    expect(
      verifyDeliveryOtp({ expectedOtp: '654321', submittedOtp: '123456' }),
    ).toBe(false);
  });

  it('rejects any OTP other than the configured one when an order OTP exists', () => {
    expect(
      verifyDeliveryOtp({ expectedOtp: '654321', submittedOtp: '999999' }),
    ).toBe(false);
  });

  it('accepts the demo OTP only when no order OTP is configured in non-production', () => {
    process.env.NODE_ENV = 'development';
    expect(verifyDeliveryOtp({ expectedOtp: null, submittedOtp: '123456' })).toBe(
      true,
    );
  });

  it('rejects a random OTP when no order OTP is configured in non-production', () => {
    process.env.NODE_ENV = 'development';
    expect(verifyDeliveryOtp({ expectedOtp: null, submittedOtp: '999999' })).toBe(
      false,
    );
  });

  it('never accepts the demo OTP in production, even when no order OTP is configured', () => {
    process.env.NODE_ENV = 'production';
    expect(verifyDeliveryOtp({ expectedOtp: null, submittedOtp: '123456' })).toBe(
      false,
    );
  });
});