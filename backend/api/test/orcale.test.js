import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/db.js', () => ({
  supabase: null,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

const { default: OracleService } = await import('../src/oracle/OracleService.js');

function createMockSupabase(store = {}) {
  return {
    from(table) {
      let rows = store[table] ? [...store[table]] : [];
      const builder = {
        _filters: [],
        _maybeSingle: false,
        _limit: null,
        eq(col, val) { builder._filters.push({ col, op: 'eq', val }); return builder; },
        limit(n) { builder._limit = n; return builder; },
        maybeSingle() { builder._maybeSingle = true; return builder; },
        select() { return builder; },
        then(resolve, reject) {
          try {
            for (const f of builder._filters) {
              rows = rows.filter(r => r[f.col] === f.val);
            }
            if (builder._limit != null) rows = rows.slice(0, builder._limit);
            const data = builder._maybeSingle ? (rows[0] ?? null) : rows;
            resolve({ data, error: null });
          } catch (e) {
            resolve({ data: null, error: { message: e.message } });
          }
        },
      };
      return builder;
    },
  };
}

describe('OracleService', () => {
  describe('confirmDelivery', () => {
    it('returns confirmation result with consensus info', async () => {
      const supabase = createMockSupabase({
        orders: [{ id: 'order-1', status: 'payment_released', otp_verified: true }],
        delivery_otps: [{ order_id: 'order-1', verified: true }],
      });

      const service = new OracleService({ supabase });
      const result = await service.confirmDelivery({
        orderId: 'order-1',
        otp: '123456',
        gpsCoordinates: { lat: 28.6139, lng: 77.2090 },
      });

      expect(result).toHaveProperty('confirmed');
      expect(result).toHaveProperty('consensusCount');
      expect(result).toHaveProperty('threshold');
      expect(result).toHaveProperty('totalProviders');
      expect(result).toHaveProperty('providerResults');
      expect(result).toHaveProperty('timestamp');
      expect(result.consensusCount).toBeGreaterThanOrEqual(0);
      expect(result.totalProviders).toBe(3);
    });

    it('returns confirmed:false when OTP is not verified', async () => {
      const supabase = createMockSupabase({
        orders: [{ id: 'order-2', status: 'in_transit', otp_verified: false }],
        delivery_otps: [],
      });

      const service = new OracleService({ supabase });
      const result = await service.confirmDelivery({
        orderId: 'order-2',
        otp: '123456',
        gpsCoordinates: { lat: 28.6139, lng: 77.2090 },
      });

      expect(result.confirmed).toBe(false);
    });

    it('returns confirmed:false when order not found', async () => {
      const supabase = createMockSupabase({ orders: [] });

      const service = new OracleService({ supabase });
      const result = await service.confirmDelivery({
        orderId: 'nonexistent',
        otp: '123456',
        gpsCoordinates: { lat: 28.6139, lng: 77.2090 },
      });

      expect(result.confirmed).toBe(false);
    });

    it('returns confirmed:false when GPS coordinates are invalid', async () => {
      const supabase = createMockSupabase({
        orders: [{ id: 'order-3', status: 'payment_released', otp_verified: true }],
        delivery_otps: [{ order_id: 'order-3', verified: true }],
      });

      const service = new OracleService({ supabase });
      const result = await service.confirmDelivery({
        orderId: 'order-3',
        otp: '123456',
        gpsCoordinates: { lat: 200, lng: 77.2090 },
      });

      expect(result.providerResults).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ provider: 'GPSVerifier', confirmed: false }),
        ])
      );
    });
  });

  describe('verifyCrossChain', () => {
    it('returns verified:true when blockchain hash matches', async () => {
      const supabase = createMockSupabase({
        orders: [{ id: 'order-1', blockchain_tx_hash: '0xabc123', escrow_status: 'funded' }],
      });

      const service = new OracleService({ supabase });
      const result = await service.verifyCrossChain('order-1', '0xabc123');

      expect(result.verified).toBe(true);
      expect(result.ipfsHash).toBe('0xabc123');
      expect(result.blockchainHash).toBe('0xabc123');
      expect(result.verificationUrl).toContain('0xabc123');
    });

    it('returns verified:false when hash does not match', async () => {
      const supabase = createMockSupabase({
        orders: [{ id: 'order-2', blockchain_tx_hash: '0xdef456', escrow_status: 'funded' }],
      });

      const service = new OracleService({ supabase });
      const result = await service.verifyCrossChain('order-2', '0xabc123');

      expect(result.verified).toBe(false);
    });

    it('returns verified:false when order not found', async () => {
      const supabase = createMockSupabase({ orders: [] });

      const service = new OracleService({ supabase });
      const result = await service.verifyCrossChain('nonexistent', '0xabc123');

      expect(result.verified).toBe(false);
      expect(result.error).toBe('Order not found');
    });

    it('returns verified:false when escrow is not funded or released', async () => {
      const supabase = createMockSupabase({
        orders: [{ id: 'order-3', blockchain_tx_hash: '0xabc123', escrow_status: 'pending' }],
      });

      const service = new OracleService({ supabase });
      const result = await service.verifyCrossChain('order-3', '0xabc123');

      expect(result.verified).toBe(false);
    });

    it('is case-insensitive for blockchain hash comparison', async () => {
      const supabase = createMockSupabase({
        orders: [{ id: 'order-4', blockchain_tx_hash: '0xABC123', escrow_status: 'released' }],
      });

      const service = new OracleService({ supabase });
      const result = await service.verifyCrossChain('order-4', '0xabc123');

      expect(result.verified).toBe(true);
    });
  });

  describe('logOracleResult', () => {
    it('returns log entry object', async () => {
      const service = new OracleService({});
      const result = await service.logOracleResult('order-1', [{ confirmed: true }], true);

      expect(result).toHaveProperty('orderId', 'order-1');
      expect(result).toHaveProperty('consensusReached', true);
      expect(result).toHaveProperty('timestamp');
      expect(result.results).toHaveLength(1);
    });
  });
});
