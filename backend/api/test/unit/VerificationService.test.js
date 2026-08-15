import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  return { mockFrom };
});

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mockFrom },
  supabaseAdmin: { from: mockFrom },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import VerificationService from '../../src/services/verification/VerificationService.js';

function makeOrder(overrides = {}) {
  return {
    id: 'order-1',
    order_display_id: 'TRX-1',
    status: 'in_transit',
    customer_id: 'cust-1',
    driver_id: 'driver-1',
    truck_id: 'truck-1',
    otp_verified: true,
    blockchain_tx_hash: null,
    escrow_status: 'funded',
    ...overrides,
  };
}

describe('VerificationService', () => {
  let service;
  let tables;

  beforeEach(() => {
    vi.clearAllMocks();
    tables = {};
    mockFrom.mockImplementation((table) => {
      if (!tables[table]) {
        throw new Error(`No mock configured for table "${table}"`);
      }
      return tables[table]();
    });
    service = new VerificationService({
      oracleService: {
        confirmDelivery: vi.fn().mockResolvedValue({
          confirmed: true,
          consensusCount: 3,
          threshold: 2,
          totalProviders: 3,
          providerResults: [],
          timestamp: '2025-01-01T00:00:00Z',
        }),
        verifyCrossChain: vi.fn().mockResolvedValue({ verified: false, ipfsHash: null }),
      },
    });
  });

  function stubTable(table, resolve) {
    tables[table] = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(resolve) })),
      })),
    });
  }

  function stubDocuments(documents, error = null) {
    tables.driver_documents = () => ({
      select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: documents, error }) })),
    });
  }

  function stubProfile(profile) {
    stubTable('profiles', { data: profile, error: null });
  }

  describe('verifyOrder', () => {
    it('marks an order verified when oracle confirms and driver checks pass', async () => {
      stubTable('orders', { data: makeOrder(), error: null });
      stubProfile({ id: 'driver-1', is_active: true, role: 'driver' });
      stubDocuments([
        { document_type: 'rc_book', status: 'approved' },
        { document_type: 'driving_licence', status: 'approved' },
      ]);

      const result = await service.verifyOrder('order-1');
      expect(result.deliveryVerified).toBe(true);
      expect(result.oracleDetails.confirmed).toBe(true);
      expect(result.driverVerification.verified).toBe(true);
      expect(result.documentIntegrity.verified).toBe(true);
      expect(result.verified).toBeUndefined();
    });

    it('does not mark delivery verified when the oracle is not confirmed', async () => {
      stubTable('orders', { data: makeOrder(), error: null });
      stubProfile(null);
      stubDocuments([]);
      service.oracleService.confirmDelivery.mockResolvedValue({
        confirmed: false,
        consensusCount: 1,
        threshold: 2,
        totalProviders: 3,
        providerResults: [],
        timestamp: '2025-01-01T00:00:00Z',
      });

      const result = await service.verifyOrder('order-1');
      expect(result.deliveryVerified).toBe(false);
      expect(result.driverVerification.verified).toBe(false);
    });

    it('returns verified false when the order is not found', async () => {
      stubTable('orders', { data: null, error: null });

      const result = await service.verifyOrder('missing');
      expect(result).toEqual({ verified: false, error: 'Order not found' });
    });

    it('verifies cross-chain when the order has a blockchain tx hash', async () => {
      stubTable('orders', { data: makeOrder({ blockchain_tx_hash: '0xabc' }), error: null });
      stubProfile(null);
      stubDocuments([]);
      service.oracleService.verifyCrossChain.mockResolvedValue({ verified: true, ipfsHash: 'ipfs://abc' });

      const result = await service.verifyOrder('order-1');
      expect(result.crossChainVerified).toBe(true);
      expect(result.ipfsHash).toBe('ipfs://abc');
      expect(service.oracleService.verifyCrossChain).toHaveBeenCalledWith('order-1', '0xabc');
    });
  });

  describe('checkDocumentIntegrity', () => {
    it('returns verified when all required documents are approved', async () => {
      stubDocuments([
        { document_type: 'rc_book', status: 'approved' },
        { document_type: 'driving_licence', status: 'approved' },
      ]);

      const result = await service.checkDocumentIntegrity('driver-1');
      expect(result.verified).toBe(true);
      expect(result.documentsChecked).toHaveLength(2);
      expect(result.documentsChecked.every(d => d.status === 'approved')).toBe(true);
    });

    it('returns not verified when a required document is missing', async () => {
      stubDocuments([{ document_type: 'rc_book', status: 'approved' }]);

      const result = await service.checkDocumentIntegrity('driver-1');
      expect(result.verified).toBe(false);
      expect(result.documentsChecked).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'driving_licence', uploaded: false, status: 'missing' }),
      ]));
    });

    it('returns all documents missing when no driver is assigned', async () => {
      const result = await service.checkDocumentIntegrity(null);
      expect(result.verified).toBe(false);
      expect(result.documentsChecked.every(d => d.status === 'missing')).toBe(true);
    });

    it('reports an error state when the documents query fails', async () => {
      stubDocuments(null, { message: 'db down' });

      const result = await service.checkDocumentIntegrity('driver-1');
      expect(result.verified).toBe(false);
      expect(result.documentsChecked.every(d => d.status === 'error')).toBe(true);
      expect(result.error).toBe('db down');
    });
  });
});
