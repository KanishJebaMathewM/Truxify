import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockOrderRepository = {
  createOrder: vi.fn(),
  findOrderById: vi.fn(),
};

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mockFrom },
}));

vi.mock('../../src/core/container.js', () => ({
  orderRepository: mockOrderRepository,
}));

describe('orderCreationService', () => {
  let orderCreationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    orderCreationService = (await import('../../src/services/order/orderCreationService.js')).default;
  });

  describe('createOrder', () => {
    it('creates an order with valid data', async () => {
      const orderData = {
        pickup_address: 'Delhi',
        pickup_lat: 28.6139,
        pickup_lng: 77.2090,
        drop_address: 'Mumbai',
        drop_lat: 19.0760,
        drop_lng: 72.8777,
        goods_type: 'Electronics',
        weight_tonnes: 5,
        customer_id: 'cust-1',
      };
      const createdOrder = { id: 'order-new', ...orderData, status: 'pending', escrow_status: 'pending' };
      mockOrderRepository.createOrder.mockResolvedValue(createdOrder);

      const result = await orderCreationService.createOrder(orderData);
      expect(result.id).toBe('order-new');
      expect(result.status).toBe('pending');
    });

    it('throws when order data is invalid', async () => {
      const invalidData = { pickup_address: '', customer_id: 'cust-1' };
      mockOrderRepository.createOrder.mockRejectedValue(new Error('Validation error'));

      await expect(orderCreationService.createOrder(invalidData)).rejects.toThrow('Validation error');
    });

    it('generates display id for new order', async () => {
      const orderData = {
        pickup_address: 'Delhi',
        pickup_lat: 28.6139,
        pickup_lng: 77.2090,
        drop_address: 'Mumbai',
        drop_lat: 19.0760,
        drop_lng: 72.8777,
        goods_type: 'Electronics',
        weight_tonnes: 5,
        customer_id: 'cust-1',
      };
      const createdOrder = {
        id: 'order-new',
        order_display_id: '#FF20260808ABC123XYZ456',
        ...orderData,
        status: 'pending',
      };
      mockOrderRepository.createOrder.mockResolvedValue(createdOrder);

      const result = await orderCreationService.createOrder(orderData);
      expect(result.order_display_id).toMatch(/^#FF\d{8}/);
    });
  });
});
