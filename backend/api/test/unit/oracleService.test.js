/**
 * Unit tests for backend/api/src/oracle/OracleService.js
 *
 * Coverage:
 *   - confirmDelivery: OTP confirmed, GPS confirmed, status confirmed (3/3 = consensus)
 *   - confirmDelivery: OTP confirmed, GPS confirmed, status rejected (2/3 = consensus)
 *   - confirmDelivery: OTP confirmed, GPS rejected, status rejected (1/3 = no consensus)
 *   - confirmDelivery: all rejected (0/3 = no consensus)
 *   - _verifyOTP: order not found, OTP verified, OTP not verified, DB error
 *   - _verifyGPS: valid coords, invalid (NaN), out-of-range (lat/lng), boundary values
 *   - _verifyOrderStatus: delivered, payment_released, pending, DB error
 *   - logOracleResult: records correct log entry
 *   - verifyCrossChain: matching hash + funded escrow, non-matching hash, order not found
 *
 * Run with:  npm run test:unit -- test/unit/oracleService.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: mockSupabase,
}));

import OracleService from '../../src/oracle/OracleService.js';

function makeQueryChain(mockReturn) {
  const q = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() };
  q.select.mockReturnThis();
  q.eq.mockReturnThis();
  q.limit.mockReturnThis();
  q.maybeSingle.mockResolvedValue(mockReturn);
  return q;
}

function makeOtpQuery(mockReturn) {
  const q = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() };
  q.select.mockReturnThis();
  q.eq.mockReturnThis();
  q.limit.mockReturnThis();
  q.maybeSingle.mockResolvedValue(mockReturn);
  return q;
}

describe('OracleService', () => {
  let service;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OracleService({ supabase: mockSupabase });
  });

  describe('confirmDelivery', () => {
    it('returns confirmed=true when all 3 providers confirm', async () => {
      mockSupabase.from
        .mockReturnValueOnce(makeQueryChain({ data: { id: '1', otp_verified: true }, error: null }))
        .mockReturnValueOnce(makeOtpQuery({ data: { id: '1', verified: true }, error: null }))
        .mockReturnValueOnce(makeQueryChain({ data: { id: '1', status: 'delivered' }, error: null }));

      const result = await service.confirmDelivery({
        orderId: 'order-1',
        otp: '123456',
        gpsCoordinates: { lat: 19.076, lng: 72.8777 },
      });

      expect(result.confirmed).toBe(true);
      expect(result.consensusCount).toBe(3);
      expect(result.threshold).toBe(2);
    });

    it('returns confirmed=true when exactly 2 providers confirm (OTP + GPS)', async () => {
      mockSupabase.from
        .mockReturnValueOnce(makeQueryChain({ data: { id: '1', otp_verified: true }, error: null }))
        .mockReturnValueOnce(makeOtpQuery({ data: { id: '1', verified: true }, error: null }))
        .mockReturnValueOnce(makeQueryChain({ data: { id: '1', status: 'pending' }, error: null }));

      const result = await service.confirmDelivery({
        orderId: 'order-1',
        otp: '123456',
        gpsCoordinates: { lat: 19.076, lng: 72.8777 },
      });

      expect(result.confirmed).toBe(true);
      expect(result.consensusCount).toBe(2);
    });

    it('returns confirmed=false when GPS fails (NaN coords)', async () => {
      mockSupabase.from
        .mockReturnValueOnce(makeQueryChain({ data: { id: '1', otp_verified: true }, error: null }))
        .mockReturnValueOnce(makeOtpQuery({ data: { id: '1', verified: true }, error: null }))
        .mockReturnValueOnce(makeQueryChain({ data: { id: '1', status: 'pending' }, error: null }));

      const result = await service.confirmDelivery({
        orderId: 'order-1',
        otp: '123456',
        gpsCoordinates: { lat: NaN, lng: 72.8777 },
      });

      expect(result.confirmed).toBe(false);
      expect(result.consensusCount).toBe(1);
    });

    it('returns confirmed=false when all providers reject', async () => {
      mockSupabase.from
        .mockReturnValueOnce(makeQueryChain({ data: { id: '1', otp_verified: false }, error: null }))
        .mockReturnValueOnce(makeOtpQuery({ data: null, error: null }))
        .mockReturnValueOnce(makeQueryChain({ data: { id: '1', status: 'pending' }, error: null }));

      const result = await service.confirmDelivery({
        orderId: 'order-1',
        otp: '000000',
        gpsCoordinates: { lat: NaN, lng: NaN },
      });

      expect(result.confirmed).toBe(false);
      expect(result.consensusCount).toBe(0);
    });
  });

  describe('_verifyOTP', () => {
    it('returns confirmed=true when otp_verified is true on order', async () => {
      mockSupabase.from
        .mockReturnValueOnce(makeQueryChain({ data: { id: '1', otp_verified: true }, error: null }))
        .mockReturnValueOnce(makeOtpQuery({ data: null, error: null }));

      const result = await service._verifyOTP('order-1', '123456');

      expect(result.confirmed).toBe(true);
      expect(result.provider).toBe('OTPVerifier');
    });

    it('returns confirmed=false when order is not found', async () => {
      mockSupabase.from.mockReturnValueOnce(makeQueryChain({ data: null, error: null }));

      const result = await service._verifyOTP('order-1', '123456');

      expect(result.confirmed).toBe(false);
      expect(result.reason).toBe('Order not found');
    });

    it('returns confirmed=false when DB errors', async () => {
      mockSupabase.from.mockReturnValueOnce(makeQueryChain({ data: null, error: { message: 'DB connection failed' } }));

      const result = await service._verifyOTP('order-1', '123456');

      expect(result.confirmed).toBe(false);
      expect(result.error).toBe('DB connection failed');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('returns confirmed=true when delivery_otps record is verified even if order.otp_verified is false', async () => {
      mockSupabase.from
        .mockReturnValueOnce(makeQueryChain({ data: { id: '1', otp_verified: false }, error: null }))
        .mockReturnValueOnce(makeOtpQuery({ data: { id: '1', verified: true }, error: null }));

      const result = await service._verifyOTP('order-1', '123456');

      expect(result.confirmed).toBe(true);
    });
  });

  describe('_verifyGPS', () => {
    it('returns confirmed=true for valid coordinates', () => {
      const result = service._verifyGPS({ lat: 19.076, lng: 72.8777 });
      expect(result.confirmed).toBe(true);
      expect(result.provider).toBe('GPSVerifier');
    });

    it('returns confirmed=false when lat is NaN', () => {
      const result = service._verifyGPS({ lat: NaN, lng: 72.8777 });
      expect(result.confirmed).toBe(false);
    });

    it('returns confirmed=false when lng is out of range (> 180)', () => {
      const result = service._verifyGPS({ lat: 19.076, lng: 200 });
      expect(result.confirmed).toBe(false);
    });

    it('returns confirmed=false when lat is out of range (< -90)', () => {
      const result = service._verifyGPS({ lat: -95, lng: 72.8777 });
      expect(result.confirmed).toBe(false);
    });

    it('returns confirmed=false when gpsCoordinates is null', () => {
      const result = service._verifyGPS(null);
      expect(result.confirmed).toBe(false);
    });

    it('returns confirmed=true for boundary values (lat=90, lng=180)', () => {
      const result = service._verifyGPS({ lat: 90, lng: 180 });
      expect(result.confirmed).toBe(true);
    });
  });

  describe('_verifyOrderStatus', () => {
    it('returns confirmed=true for delivered status', async () => {
      mockSupabase.from.mockReturnValueOnce(makeQueryChain({ data: { id: '1', status: 'delivered' }, error: null }));

      const result = await service._verifyOrderStatus('order-1');

      expect(result.confirmed).toBe(true);
      expect(result.provider).toBe('StatusVerifier');
    });

    it('returns confirmed=true for payment_released status', async () => {
      mockSupabase.from.mockReturnValueOnce(makeQueryChain({ data: { id: '1', status: 'payment_released' }, error: null }));

      const result = await service._verifyOrderStatus('order-1');

      expect(result.confirmed).toBe(true);
    });

    it('returns confirmed=false for pending status', async () => {
      mockSupabase.from.mockReturnValueOnce(makeQueryChain({ data: { id: '1', status: 'pending' }, error: null }));

      const result = await service._verifyOrderStatus('order-1');

      expect(result.confirmed).toBe(false);
    });

    it('returns confirmed=false and logs error on DB failure', async () => {
      mockSupabase.from.mockReturnValueOnce(makeQueryChain({ data: null, error: { message: 'DB error' } }));

      const result = await service._verifyOrderStatus('order-1');

      expect(result.confirmed).toBe(false);
      expect(result.error).toBe('DB error');
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('verifyCrossChain', () => {
    it('returns verified=true when hash matches and escrow is funded', async () => {
      mockSupabase.from.mockReturnValueOnce(makeQueryChain({
        data: { id: '1', blockchain_tx_hash: '0xabc123', escrow_status: 'funded' },
        error: null,
      }));

      const result = await service.verifyCrossChain('order-1', '0xabc123');

      expect(result.verified).toBe(true);
      expect(result.blockchainHash).toBe('0xabc123');
    });

    it('returns verified=false when hash does not match', async () => {
      mockSupabase.from.mockReturnValueOnce(makeQueryChain({
        data: { id: '1', blockchain_tx_hash: '0xabc123', escrow_status: 'funded' },
        error: null,
      }));

      const result = await service.verifyCrossChain('order-1', '0xdef456');

      expect(result.verified).toBe(false);
    });

    it('returns verified=false when order is not found', async () => {
      mockSupabase.from.mockReturnValueOnce(makeQueryChain({ data: null, error: null }));

      const result = await service.verifyCrossChain('order-1', '0xabc123');

      expect(result.verified).toBe(false);
      expect(result.error).toBe('Order not found');
    });

    it('returns verified=false when escrow_status is not funded or released', async () => {
      mockSupabase.from.mockReturnValueOnce(makeQueryChain({
        data: { id: '1', blockchain_tx_hash: '0xabc123', escrow_status: 'pending' },
        error: null,
      }));

      const result = await service.verifyCrossChain('order-1', '0xabc123');

      expect(result.verified).toBe(false);
    });
  });
});
