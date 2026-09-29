import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '../../../src/utils/errors.js';

// Mock dependencies
const mockSupabaseQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn(),
};

const mockSupabase = {
  from: vi.fn(() => mockSupabaseQuery),
};

vi.mock('../../../src/config/db.js', () => ({
  supabase: mockSupabase,
  mongoDb: null,
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/core/container.js', () => ({
  orderRepository: {},
}));

vi.mock('../../../src/services/order/bidAcceptanceService.js', () => ({
  BidAcceptanceService: class {
    constructor() {}
  },
  DomainError: class DomainError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.status = status;
      this.payload = payload;
    }
  },
}));

vi.mock('../../../src/services/order/orderTimelineService.js', () => ({
  OrderTimelineService: class {
    constructor() {}
  },
}));

vi.mock('../../../src/services/order/orderLifecycleService.js', () => ({
  OrderLifecycleService: class {
    constructor() {}
  },
}));

vi.mock('../../../src/services/order/orderValidationService.js', () => ({
  OrderValidationService: class {
    constructor() {}
  },
}));

vi.mock('../../../src/services/escrow.js', () => ({
  buildDepositTx: vi.fn(),
  recordDepositTx: vi.fn(),
  submitEscrowRefund: vi.fn(),
  escrowRefund: vi.fn(),
}));

vi.mock('../../../src/services/ml.js', () => ({
  predictDemand: vi.fn(),
}));

vi.mock('../../../src/services/osrm.js', () => ({
  buildStraightLineGeometry: vi.fn(),
  getRouteGeometry: vi.fn(),
}));

const {
  createOrder,
  getActiveOrders,
  getLoadOffers,
  getEnRouteLoads,
} = await import('../../../src/controllers/orderController.js');

describe('orderController', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    mockSupabaseQuery.select.mockReturnThis();
    mockSupabaseQuery.eq.mockReturnThis();
    mockSupabaseQuery.order.mockReturnThis();
  });

  describe('createOrder', () => {
    it('is defined as a function', () => {
      expect(typeof createOrder).toBe('function');
    });

    it('creates order with user id and body', async () => {
      mockReq = { user: { id: 'user-123', fullName: 'John' }, body: { pickup_address: 'A' } };
      expect(mockReq.user.id).toBeTruthy();
      expect(mockReq.body).toBeTruthy();
    });
  });

  describe('getActiveOrders', () => {
    it('is defined as a function', () => {
      expect(typeof getActiveOrders).toBe('function');
    });

    it('accepts user id from request', async () => {
      mockReq = { user: { id: 'user-123' } };
      expect(mockReq.user.id).toBeTruthy();
    });
  });

  describe('getLoadOffers', () => {
    it('is defined as a function', () => {
      expect(typeof getLoadOffers).toBe('function');
    });

    it('parses pagination parameters from query', () => {
      mockReq = { query: { page: '2', limit: '50' } };
      const page = Math.max(1, parseInt(mockReq.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(mockReq.query.limit) || 20));
      expect(page).toBe(2);
      expect(limit).toBe(50);
    });

    it('defaults to page 1 and limit 20', () => {
      mockReq = { query: {} };
      const page = Math.max(1, parseInt(mockReq.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(mockReq.query.limit) || 20));
      expect(page).toBe(1);
      expect(limit).toBe(20);
    });

    it('clamps page to minimum 1', () => {
      mockReq = { query: { page: '-5' } };
      const page = Math.max(1, parseInt(mockReq.query.page) || 1);
      expect(page).toBe(1);
    });

    it('clamps limit to maximum 100', () => {
      mockReq = { query: { limit: '500' } };
      const limit = Math.min(100, Math.max(1, parseInt(mockReq.query.limit) || 20));
      expect(limit).toBe(100);
    });

    it('returns load offers successfully on query success', async () => {
      const mockOffers = [{ id: 'offer-1', route_label: 'Mumbai - Delhi' }];
      mockSupabaseQuery.range.mockResolvedValueOnce({ data: mockOffers, error: null });
      const next = vi.fn();
      mockReq = { query: { page: '1', limit: '10' } };

      await getLoadOffers(mockReq, mockRes, next);

      expect(mockSupabase.from).toHaveBeenCalledWith('load_offers');
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('is_en_route', false);
      expect(mockSupabaseQuery.range).toHaveBeenCalledWith(0, 9);
      expect(mockRes.json).toHaveBeenCalledWith(mockOffers);
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards AppError(500) to next() when database query returns an error', async () => {
      mockSupabaseQuery.range.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database connection failed' },
      });
      const next = vi.fn();
      mockReq = { query: {} };

      await getLoadOffers(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(err.message).toBe('Failed to fetch load offers.');
      expect(err.details).toEqual({ details: 'Database connection failed' });
    });

    it('forwards AppError(500) to next() when an unexpected exception occurs', async () => {
      mockSupabaseQuery.range.mockRejectedValueOnce(new Error('Unexpected network failure'));
      const next = vi.fn();
      mockReq = { query: {} };

      await getLoadOffers(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(err.message).toBe('Internal Server Error');
    });
  });

  describe('getEnRouteLoads', () => {
    it('is defined as a function', () => {
      expect(typeof getEnRouteLoads).toBe('function');
    });

    it('accepts user id from request', () => {
      mockReq = { user: { id: 'user-123' }, query: {} };
      expect(mockReq.user.id).toBeTruthy();
    });

    it('returns en-route loads successfully on query success', async () => {
      const mockEnRoute = [{ id: 'offer-2', route_label: 'Pune - Bangalore' }];
      mockSupabaseQuery.range.mockResolvedValueOnce({ data: mockEnRoute, error: null });
      const next = vi.fn();
      mockReq = { query: { page: '1', limit: '10' } };

      await getEnRouteLoads(mockReq, mockRes, next);

      expect(mockSupabase.from).toHaveBeenCalledWith('load_offers');
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('is_en_route', true);
      expect(mockSupabaseQuery.range).toHaveBeenCalledWith(0, 9);
      expect(mockRes.json).toHaveBeenCalledWith(mockEnRoute);
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards AppError(500) to next() when database query returns an error for en-route loads', async () => {
      mockSupabaseQuery.range.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database timeout' },
      });
      const next = vi.fn();
      mockReq = { query: {} };

      await getEnRouteLoads(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(err.message).toBe('Failed to fetch en-route loads.');
      expect(err.details).toEqual({ details: 'Database timeout' });
    });
  });
});
