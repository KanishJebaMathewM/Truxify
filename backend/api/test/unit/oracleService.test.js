import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabaseFrom = vi.fn();
vi.mock('../../src/config/db.js', () => ({
  supabase: { from: () => mockSupabaseFrom() },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockVerifyDeliveryOtpHash = vi.fn();
vi.mock('../../src/services/notificationService.js', () => ({
  verifyDeliveryOtpHash: (...args) => mockVerifyDeliveryOtpHash(...args),
}));

const { OracleService } = await import('../../src/oracle/OracleService.js');

describe('OracleService', () => {
  let oracleService;

  beforeEach(() => {
    vi.clearAllMocks();
    oracleService = new OracleService({});
  });

  describe('_verifyOTP', () => {
    it('returns confirmed:true for valid OTP', async () => {
      mockVerifyDeliveryOtpHash.mockReturnValue(true);
      mockSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'otp1', otp_hash: 'hash', otp_salt: 'salt', expires_at: '2099-12-31T23:59:59Z' },
          error: null,
        }),
      });
      const result = await oracleService._verifyOTP('order-1', '123456');
      expect(result.confirmed).toBe(true);
      expect(result.provider).toBe('OTPVerifier');
    });

    it('returns confirmed:false when no OTP record found', async () => {
      mockSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const result = await oracleService._verifyOTP('order-1', '123456');
      expect(result.confirmed).toBe(false);
      expect(result.reason).toBe('No OTP record found for order');
    });

    it('returns confirmed:false when OTP is expired', async () => {
      mockSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'otp1', otp_hash: 'hash', otp_salt: 'salt', expires_at: '2020-01-01T00:00:00Z' },
          error: null,
        }),
      });
      const result = await oracleService._verifyOTP('order-1', '123456');
      expect(result.confirmed).toBe(false);
      expect(result.reason).toBe('OTP expired');
    });

    it('returns confirmed:false when OTP verification fails', async () => {
      mockVerifyDeliveryOtpHash.mockReturnValue(false);
      mockSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'otp1', otp_hash: 'hash', otp_salt: 'salt', expires_at: '2099-12-31T23:59:59Z' },
          error: null,
        }),
      });
      const result = await oracleService._verifyOTP('order-1', 'wrong');
      expect(result.confirmed).toBe(false);
    });
  });

  describe('_verifyGPS', () => {
    it('returns confirmed:true for valid GPS coordinates', async () => {
      mockSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'order-1', driver_id: 'driver-1', drop_lat: 19.07, drop_lng: 72.87 },
          error: null,
        }),
      });
      const result = await oracleService._verifyGPS('order-1', { lat: 19.07, lng: 72.87 });
      expect(result.confirmed).toBe(true);
      expect(result.provider).toBe('GPSVerifier');
    });

    it('returns confirmed:false for null gpsCoordinates', async () => {
      const result = await oracleService._verifyGPS('order-1', null);
      expect(result.confirmed).toBe(false);
      expect(result.provider).toBe('GPSVerifier');
    });

    it('returns confirmed:false for out-of-range latitude', async () => {
      const result = await oracleService._verifyGPS('order-1', { lat: 100, lng: 72 });
      expect(result.confirmed).toBe(false);
    });

    it('returns confirmed:false for out-of-range longitude', async () => {
      const result = await oracleService._verifyGPS('order-1', { lat: 19, lng: 200 });
      expect(result.confirmed).toBe(false);
    });
  });

  describe('confirmDelivery', () => {
    beforeEach(() => {
      vi.spyOn(oracleService, '_verifyOTP').mockResolvedValue({ confirmed: true, provider: 'OTPVerifier' });
      vi.spyOn(oracleService, '_verifyGPS').mockResolvedValue({ confirmed: true, provider: 'GPSVerifier' });
      vi.spyOn(oracleService, '_verifyOrderStatus').mockResolvedValue({ confirmed: true, provider: 'StatusVerifier' });
      vi.spyOn(oracleService, 'logOracleResult').mockResolvedValue(undefined);
    });

    it('returns confirmed:true when 2+ providers confirm', async () => {
      const result = await oracleService.confirmDelivery({ orderId: 'order-1', otp: '123456', gpsCoordinates: { lat: 19, lng: 72 } });
      expect(result.confirmed).toBe(true);
      expect(result.consensusCount).toBe(3);
    });

    it('returns confirmed:false when fewer than 2 providers confirm', async () => {
      oracleService._verifyGPS.mockResolvedValueOnce({ confirmed: false, provider: 'GPSVerifier' });
      const result = await oracleService.confirmDelivery({ orderId: 'order-1', otp: '123456', gpsCoordinates: { lat: 19, lng: 72 } });
      expect(result.confirmed).toBe(false);
      expect(result.consensusCount).toBe(2);
    });
  });
});
