import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpcMock, loggerMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  loggerMock: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: {
    rpc: rpcMock,
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: loggerMock,
}));

import { incrementOtpAttempts } from '../../src/services/otpService.js';

describe('incrementOtpAttempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('increments OTP attempts through the atomic RPC', async () => {
    rpcMock.mockResolvedValueOnce({
      data: 5,
      error: null,
    });

    const result = await incrementOtpAttempts('otp-123');

    expect(result).toBe(5);
    expect(rpcMock).toHaveBeenCalledWith(
      'increment_otp_attempts',
      { otp_id: 'otp-123' }
    );
  });

  it('returns 0 when the RPC fails', async () => {
    const error = new Error('RPC failed');

    rpcMock.mockResolvedValueOnce({
      data: null,
      error,
    });

    const result = await incrementOtpAttempts('otp-123');

    expect(result).toBe(0);
    expect(loggerMock.error).toHaveBeenCalledWith(
      { err: error, otpId: 'otp-123' },
      'Failed to increment OTP attempts'
    );
  });

  it('returns 0 without calling the RPC when otpId is missing', async () => {
    const result = await incrementOtpAttempts('');

    expect(result).toBe(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
