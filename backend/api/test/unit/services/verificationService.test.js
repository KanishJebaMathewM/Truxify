import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/config/db.js', () => ({
  supabase: null,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

const { default: VerificationService } = await import('../../../src/services/verification/VerificationService.js');

function createMockSupabase(store = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      let rows = store[table] ? [...store[table]] : [];
      const builder = {
        _filters: [],
        _selectCols: '*',
        _maybeSingle: false,
        _limit: null,
        eq(col, val) { builder._filters.push({ col, op: 'eq', val }); return builder; },
        select(cols) { builder._selectCols = cols; return builder; },
        limit(n) { builder._limit = n; return builder; },
        maybeSingle() { builder._maybeSingle = true; return builder; },
        then(resolve, reject) {
          try {
            for (const f of builder._filters) {
              rows = rows.filter(r => r[f.col] === f.val);
            }
            if (builder._limit != null) rows = rows.slice(0, builder._limit);
            const data = builder._maybeSingle ? (rows[0] ?? null) : rows;
            calls.push({ table, filters: builder._filters, select: builder._selectCols });
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

function createMockOracleService(overrides = {}) {
  return {
    confirmDelivery: vi.fn(async ({ orderId }) => ({
      confirmed: true,
      consensusCount: 3,
      threshold: 2,
      totalProviders: 3,
      providerResults: [
        { confirmed: true, provider: 'OTPVerifier' },
        { confirmed: true, provider: 'GPSVerifier' },
        { confirmed: true, provider: 'StatusVerifier' },
      ],
      timestamp: new Date().toISOString(),
      ...overrides,
    })),
    verifyCrossChain: vi.fn(async (orderId, blockchainHash) => ({
      verified: true,
      ipfsHash: blockchainHash,
      blockchainHash,
      verificationUrl: `https://polygonscan.com/tx/${blockchainHash}`,
    })),
  };
}

const VALID_ORDER_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_DRIVER_ID = '660e8400-e29b-41d4-a716-446655440001';
const VALID_TRUCK_ID = '770e8400-e29b-41d4-a716-446655440002';

describe('VerificationService', () => {
  describe('verifyOrder', () => {
    it('returns verified:false when order not found', async () => {
      const supabase = createMockSupabase({ orders: [] });
      const oracleService = createMockOracleService();
      const service = new VerificationService({ supabase, oracleService });

      const result = await service.verifyOrder(VALID_ORDER_ID);

      expect(result.verified).toBe(false);
      expect(result.error).toBe('Order not found');
    });

    it('returns full verification result for a valid delivered order', async () => {
      const order = {
        id: VALID_ORDER_ID,
        order_display_id: 'ORD-001',
        status: 'payment_released',
        customer_id: 'customer-1',
        driver_id: VALID_DRIVER_ID,
        truck_id: VALID_TRUCK_ID,
        delivery_otp: '123456',
        otp_verified: true,
        blockchain_tx_hash: '0xabc123',
        escrow_status: 'released',
      };

      const supabase = createMockSupabase({
        orders: [order],
        profiles: [{ id: VALID_DRIVER_ID, is_active: true, role: 'driver' }],
        driver_documents: [
          { driver_id: VALID_DRIVER_ID, document_type: 'rc_book', status: 'approved', created_at: '2024-01-01' },
          { driver_id: VALID_DRIVER_ID, document_type: 'driving_licence', status: 'approved', created_at: '2024-01-01' },
        ],
      });

      const oracleService = createMockOracleService();
      const service = new VerificationService({ supabase, oracleService });

      const result = await service.verifyOrder(VALID_ORDER_ID);

      expect(result.orderId).toBe(VALID_ORDER_ID);
      expect(result.deliveryVerified).toBe(true);
      expect(result.crossChainVerified).toBe(true);
      expect(result.documentIntegrity.verified).toBe(true);
      expect(result.driverVerification.verified).toBe(true);
      expect(result.driverVerification.driverActive).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it('marks deliveryVerified as false when order status is not delivered', async () => {
      const order = {
        id: VALID_ORDER_ID,
        status: 'in_transit',
        driver_id: VALID_DRIVER_ID,
        truck_id: VALID_TRUCK_ID,
        blockchain_tx_hash: null,
        escrow_status: null,
      };

      const supabase = createMockSupabase({
        orders: [order],
        profiles: [{ id: VALID_DRIVER_ID, is_active: true, role: 'driver' }],
        driver_documents: [
          { driver_id: VALID_DRIVER_ID, document_type: 'rc_book', status: 'approved', created_at: '2024-01-01' },
          { driver_id: VALID_DRIVER_ID, document_type: 'driving_licence', status: 'approved', created_at: '2024-01-01' },
        ],
      });

      const oracleService = createMockOracleService();
      const service = new VerificationService({ supabase, oracleService });

      const result = await service.verifyOrder(VALID_ORDER_ID);

      expect(result.deliveryVerified).toBe(false);
      expect(result.orderId).toBe(VALID_ORDER_ID);
    });

    it('marks crossChainVerified as false when no blockchain hash', async () => {
      const order = {
        id: VALID_ORDER_ID,
        status: 'payment_released',
        driver_id: VALID_DRIVER_ID,
        truck_id: VALID_TRUCK_ID,
        blockchain_tx_hash: null,
        escrow_status: 'released',
      };

      const supabase = createMockSupabase({
        orders: [order],
        profiles: [{ id: VALID_DRIVER_ID, is_active: true, role: 'driver' }],
        driver_documents: [
          { driver_id: VALID_DRIVER_ID, document_type: 'rc_book', status: 'approved', created_at: '2024-01-01' },
          { driver_id: VALID_DRIVER_ID, document_type: 'driving_licence', status: 'approved', created_at: '2024-01-01' },
        ],
      });

      const oracleService = createMockOracleService();
      const service = new VerificationService({ supabase, oracleService });

      const result = await service.verifyOrder(VALID_ORDER_ID);

      expect(result.crossChainVerified).toBe(false);
      expect(result.ipfsHash).toBeNull();
    });

    it('marks driverVerification as failed when driver is inactive', async () => {
      const order = {
        id: VALID_ORDER_ID,
        status: 'payment_released',
        driver_id: VALID_DRIVER_ID,
        truck_id: VALID_TRUCK_ID,
        blockchain_tx_hash: '0xabc',
        escrow_status: 'released',
      };

      const supabase = createMockSupabase({
        orders: [order],
        profiles: [{ id: VALID_DRIVER_ID, is_active: false, role: 'driver' }],
        driver_documents: [
          { driver_id: VALID_DRIVER_ID, document_type: 'rc_book', status: 'approved', created_at: '2024-01-01' },
          { driver_id: VALID_DRIVER_ID, document_type: 'driving_licence', status: 'approved', created_at: '2024-01-01' },
        ],
      });

      const oracleService = createMockOracleService();
      const service = new VerificationService({ supabase, oracleService });

      const result = await service.verifyOrder(VALID_ORDER_ID);

      expect(result.driverVerification.verified).toBe(false);
      expect(result.driverVerification.driverActive).toBe(false);
    });

    it('handles order with no driver assigned', async () => {
      const order = {
        id: VALID_ORDER_ID,
        status: 'pending',
        driver_id: null,
        truck_id: null,
        blockchain_tx_hash: null,
        escrow_status: null,
      };

      const supabase = createMockSupabase({
        orders: [order],
        driver_documents: [],
      });

      const oracleService = createMockOracleService();
      const service = new VerificationService({ supabase, oracleService });

      const result = await service.verifyOrder(VALID_ORDER_ID);

      expect(result.orderId).toBe(VALID_ORDER_ID);
      expect(result.driverVerification.verified).toBe(false);
      expect(result.documentIntegrity.verified).toBe(false);
    });

    it('catches and returns DB errors', async () => {
      const supabase = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: { message: 'connection refused' } }),
            }),
          }),
        }),
      };
      const oracleService = createMockOracleService();
      const service = new VerificationService({ supabase, oracleService });

      const result = await service.verifyOrder(VALID_ORDER_ID);

      expect(result.verified).toBe(false);
      expect(result.error).toBe('connection refused');
    });
  });

  describe('checkDocumentIntegrity', () => {
    it('returns verified:true when all required docs are approved', async () => {
      const supabase = createMockSupabase({
        driver_documents: [
          { driver_id: VALID_DRIVER_ID, document_type: 'rc_book', status: 'approved', created_at: '2024-01-01' },
          { driver_id: VALID_DRIVER_ID, document_type: 'driving_licence', status: 'approved', created_at: '2024-01-01' },
        ],
      });

      const service = new VerificationService({ supabase });
      const result = await service.checkDocumentIntegrity(VALID_DRIVER_ID);

      expect(result.verified).toBe(true);
      expect(result.documentsChecked).toHaveLength(2);
      expect(result.documentsChecked.find(d => d.type === 'rc_book').uploaded).toBe(true);
      expect(result.documentsChecked.find(d => d.type === 'rc_book').status).toBe('approved');
      expect(result.documentsChecked.find(d => d.type === 'driving_licence').uploaded).toBe(true);
      expect(result.lastCheck).toBeDefined();
    });

    it('returns verified:false when required docs are missing', async () => {
      const supabase = createMockSupabase({
        driver_documents: [],
      });

      const service = new VerificationService({ supabase });
      const result = await service.checkDocumentIntegrity(VALID_DRIVER_ID);

      expect(result.verified).toBe(false);
      expect(result.documentsChecked.find(d => d.type === 'rc_book').status).toBe('missing');
      expect(result.documentsChecked.find(d => d.type === 'driving_licence').status).toBe('missing');
    });

    it('returns verified:false when docs exist but not approved', async () => {
      const supabase = createMockSupabase({
        driver_documents: [
          { driver_id: VALID_DRIVER_ID, document_type: 'rc_book', status: 'pending_review', created_at: '2024-01-01' },
          { driver_id: VALID_DRIVER_ID, document_type: 'driving_licence', status: 'approved', created_at: '2024-01-01' },
        ],
      });

      const service = new VerificationService({ supabase });
      const result = await service.checkDocumentIntegrity(VALID_DRIVER_ID);

      expect(result.verified).toBe(false);
      expect(result.documentsChecked.find(d => d.type === 'rc_book').status).toBe('pending_review');
      expect(result.documentsChecked.find(d => d.type === 'driving_licence').status).toBe('approved');
    });

    it('returns verified:false when a doc is rejected', async () => {
      const supabase = createMockSupabase({
        driver_documents: [
          { driver_id: VALID_DRIVER_ID, document_type: 'rc_book', status: 'approved', created_at: '2024-01-01' },
          { driver_id: VALID_DRIVER_ID, document_type: 'driving_licence', status: 'rejected', created_at: '2024-01-01' },
        ],
      });

      const service = new VerificationService({ supabase });
      const result = await service.checkDocumentIntegrity(VALID_DRIVER_ID);

      expect(result.verified).toBe(false);
      expect(result.documentsChecked.find(d => d.type === 'driving_licence').status).toBe('rejected');
    });

    it('prefers approved status when duplicate doc types exist', async () => {
      const supabase = createMockSupabase({
        driver_documents: [
          { driver_id: VALID_DRIVER_ID, document_type: 'rc_book', status: 'rejected', created_at: '2024-01-01' },
          { driver_id: VALID_DRIVER_ID, document_type: 'rc_book', status: 'approved', created_at: '2024-02-01' },
          { driver_id: VALID_DRIVER_ID, document_type: 'driving_licence', status: 'approved', created_at: '2024-01-01' },
        ],
      });

      const service = new VerificationService({ supabase });
      const result = await service.checkDocumentIntegrity(VALID_DRIVER_ID);

      expect(result.verified).toBe(true);
      expect(result.documentsChecked.find(d => d.type === 'rc_book').status).toBe('approved');
    });

    it('handles null driverId gracefully', async () => {
      const service = new VerificationService({});
      const result = await service.checkDocumentIntegrity(null);

      expect(result.verified).toBe(false);
      expect(result.documentsChecked).toHaveLength(2);
      expect(result.documentsChecked.every(d => d.status === 'missing')).toBe(true);
    });

    it('handles DB errors gracefully', async () => {
      const supabase = {
        from: () => ({
          select: () => ({
            eq: () => Promise.resolve({ data: null, error: { message: 'timeout' } }),
          }),
        }),
      };

      const service = new VerificationService({ supabase });
      const result = await service.checkDocumentIntegrity(VALID_DRIVER_ID);

      expect(result.verified).toBe(false);
      expect(result.error).toBe('timeout');
      expect(result.documentsChecked).toHaveLength(2);
    });

    it('includes non-required document types in query but only checks required ones', async () => {
      const supabase = createMockSupabase({
        driver_documents: [
          { driver_id: VALID_DRIVER_ID, document_type: 'rc_book', status: 'approved', created_at: '2024-01-01' },
          { driver_id: VALID_DRIVER_ID, document_type: 'driving_licence', status: 'approved', created_at: '2024-01-01' },
          { driver_id: VALID_DRIVER_ID, document_type: 'aadhaar_card', status: 'approved', created_at: '2024-01-01' },
          { driver_id: VALID_DRIVER_ID, document_type: 'pan_card', status: 'approved', created_at: '2024-01-01' },
        ],
      });

      const service = new VerificationService({ supabase });
      const result = await service.checkDocumentIntegrity(VALID_DRIVER_ID);

      expect(result.verified).toBe(true);
      expect(result.documentsChecked).toHaveLength(2);
      expect(result.documentsChecked.find(d => d.type === 'aadhaar_card')).toBeUndefined();
    });
  });
});
