import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderValidationService } from '../../src/services/order/orderValidationService.js';

const mockOrderRepository = {
  findOrderById: vi.fn(),
  findOrderByDisplayId: vi.fn(),
};

const mockSupabase = { from: vi.fn() };

vi.mock('../../src/config/db.js', () => ({ supabase: mockSupabase }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('orderValidationService', () => {
  let orderValidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    orderValidationService = new OrderValidationService({
      supabase: mockSupabase,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    orderValidationService.orderRepository = mockOrderRepository;
  });

  describe('findOrderByIdOrDisplayId', () => {
    it('finds order by UUID id', async () => {
      const order = { id: 'order-uuid-1', order_display_id: '#FF20260808ABC', status: 'pending' };
      mockOrderRepository.findOrderById.mockResolvedValue({ data: order, error: null });

      const result = await orderValidationService.findOrderByIdOrDisplayId('order-uuid-1');
      expect(result).toEqual(order);
    });

    it('finds order by display id', async () => {
      const order = { id: 'order-uuid-1', order_display_id: '#FF20260808ABC', status: 'pending' };
      mockOrderRepository.findOrderById.mockResolvedValue({ data: null, error: null });
      mockOrderRepository.findOrderByDisplayId.mockResolvedValue({ data: order, error: null });

      const result = await orderValidationService.findOrderByIdOrDisplayId('#FF20260808ABC');
      expect(result).toEqual(order);
    });

    it('returns null when order not found by either id', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({ data: null, error: null });
      mockOrderRepository.findOrderByDisplayId.mockResolvedValue({ data: null, error: null });

      const result = await orderValidationService.findOrderByIdOrDisplayId('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('validateOrderForBidAcceptance', () => {
    it('returns true for order in accepting state', () => {
      const order = { id: 'order-1', status: 'pending', escrow_status: 'pending' };
      const result = orderValidationService.validateOrderForBidAcceptance(order);
      expect(result).toBe(true);
    });

    it('returns false for order in terminal state', () => {
      const order = { id: 'order-1', status: 'delivered' };
      const result = orderValidationService.validateOrderForBidAcceptance(order);
      expect(result).toBe(false);
    });
  });
});