import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

// Build a configurable supabase chain mock.
function createChain({ otpRecord, orderRecord, error = null } = {}) {
  const chain = {
    otpRecord,
    orderRecord,
    error,
    from: vi.fn(),
    select: vi.fn(function () {
      return this;
    }),
    eq: vi.fn(function () {
      return this;
    }),
    order: vi.fn(function () {
      return this;
    }),
    limit: vi.fn(function () {
      return this;
    }),
    maybeSingle: vi.fn(function () {
      const data = this.lastTable === 'delivery_otps'
        ? this.otpRecord
        : this.orderRecord;
      return Promise.resolve({ data: data ?? null, error: this.error });
    }),
  };
  chain.from = vi.fn((table) => {
    chain.lastTable = table;
    return chain;
  });
  return chain;
}

const { default: OracleService } = await import('../../../src/oracle/OracleService.js');
// Use the real hashing helper to build a verifiable OTP record.
const { hashOtp } = await import('../../../src/lib/otpHashing.js');

describe('OracleService', () => {
  let service;
  let chain;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    chain = createChain();
    service = new OracleService({ supabase: { from: chain.from }, orderRepository: null });
  });

  describe('confirmDelivery', () => {
    it('reaches consensus when 2 of 3 providers confirm', async () => {
      const { hash, salt } = hashOtp('123456');
      const otpRecord = {
        id: 'otp-1',
        otp_hash: hash,
        otp_salt: salt,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      };
      // OTP confirms via the real hash; status is in-progress; GPS provider
      // fails (no driver telemetry) — so consensus is 2/3.
      chain.otpRecord = otpRecord;
      chain.orderRecord = { id: 'order-1', status: 'in_transit', driver_id: 'd1', drop_lat: 12.9, drop_lng: 77.5 };

      const result = await service.confirmDelivery({
        orderId: 'order-1',
        otp: '123456',
        gpsCoordinates: { lat: 12.9, lng: 77.5 },
      });

      expect(result.confirmed).toBe(true);
      expect(result.consensusCount).toBeGreaterThanOrEqual(2);
      expect(result.threshold).toBe(2);
      expect(result.providerResults).toHaveLength(3);
    });

    it('does not reach consensus with fewer than 2 confirmations', async () => {
      chain.orderRecord = { id: 'order-1', status: 'delivered' };
      chain.otpRecord = null;

      const result = await service.confirmDelivery({
        orderId: 'order-1',
        otp: 'wrong',
        gpsCoordinates: null,
      });

      expect(result.confirmed).toBe(false);
      expect(result.consensusCount).toBeLessThan(2);
    });
  });

  describe('_verifyOTP', () => {
    it('returns already verified when orders.otp_verified is true', async () => {
      // First query returns order with otp_verified=true.
      chain.orderRecord = { id: 'order-1', otp_verified: true };
      chain.otpRecord = null;
      const result = await service._verifyOTP('order-1', '123456');
      expect(result.confirmed).toBe(true);
      expect(result.reason).toBe('Already verified');
      // Should not query delivery_otps when already verified.
      const fromCalls = chain.from.mock.calls;
      expect(fromCalls.length).toBe(1);
      expect(fromCalls[0][0]).toBe('orders');
    });

    it('fails when no OTP record exists', async () => {
      chain.otpRecord = null;
      chain.orderRecord = null;
      const result = await service._verifyOTP('order-1', '123456');
      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('No OTP record');
    });

    it('fails for an expired OTP', async () => {
      chain.otpRecord = {
        id: 'otp-1',
        otp_hash: 'x',
        expires_at: new Date(Date.now() - 60000).toISOString(),
      };
      chain.orderRecord = null;
      const result = await service._verifyOTP('order-1', '123456');
      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('expired');
    });
  });

  describe('_verifyGPS', () => {
    it('fails for invalid coordinates', async () => {
      const result = await service._verifyGPS('order-1', { lat: 999, lng: 77.5 });
      expect(result.confirmed).toBe(false);
    });

    it('fails when the order is not found', async () => {
      chain.orderRecord = null;
      const result = await service._verifyGPS('order-1', { lat: 12.9, lng: 77.5 });
      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('Order not found');
    });
  });

  describe('_verifyOrderStatus', () => {
    it('confirms for in-progress statuses', async () => {
      for (const status of ['picked_up', 'in_transit', 'arriving']) {
        chain.orderRecord = { id: 'order-1', status };
        const result = await service._verifyOrderStatus('order-1');
        expect(result.confirmed).toBe(true);
      }
    });

    it('rejects terminal statuses', async () => {
      chain.orderRecord = { id: 'order-1', status: 'delivered' };
      const result = await service._verifyOrderStatus('order-1');
      expect(result.confirmed).toBe(false);
    });
  });

  describe('verifyCrossChain', () => {
    it('verifies when the hash matches and escrow is funded', async () => {
      chain.orderRecord = {
        id: 'order-1',
        blockchain_tx_hash: '0xABC123',
        escrow_status: 'funded',
      };
      const result = await service.verifyCrossChain('order-1', '0xabc123');
      expect(result.verified).toBe(true);
      expect(result.verificationUrl).toContain('polygonscan.com');
    });

    it('fails when the hash differs', async () => {
      chain.orderRecord = {
        id: 'order-1',
        blockchain_tx_hash: '0xABC123',
        escrow_status: 'funded',
      };
      const result = await service.verifyCrossChain('order-1', '0xDIFFERENT');
      expect(result.verified).toBe(false);
    });

    it('fails when escrow is not funded', async () => {
      chain.orderRecord = {
        id: 'order-1',
        blockchain_tx_hash: '0xABC123',
        escrow_status: 'pending',
      };
      const result = await service.verifyCrossChain('order-1', '0xabc123');
      expect(result.verified).toBe(false);
    });
  });
});
