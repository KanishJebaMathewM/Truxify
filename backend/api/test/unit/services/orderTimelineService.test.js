import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock } from '../../helpers/supabaseMock.js';
import { OrderRepository } from '../../../src/repositories/orderRepository.js';
import { OrderTimelineService } from '../../../src/services/order/orderTimelineService.js';
import { DomainError } from '../../../src/services/order/bidAcceptanceService.js';

describe('OrderTimelineService', () => {
  let m;
  let service;

  beforeEach(() => {
    m = createSupabaseMock();
    const repo = new OrderRepository(m.supabase);
    service = new OrderTimelineService(repo);
    m.store.orders = [];
    m.store.order_timeline = [];
    m.calls.length = 0;
  });

  describe('createOrderTimeline', () => {
    it('creates 8 default milestones for a new order', async () => {
      await service.createOrderTimeline('ORD-001');

      const timeline = m.store.order_timeline;
      expect(timeline).toHaveLength(8);
      expect(timeline[0]).toMatchObject({
        order_display_id: 'ORD-001',
        milestone: 'Order Placed',
        completed: true,
        sort_order: 10,
      });
      expect(timeline[0].milestone_time).toBeTruthy();

      expect(timeline[7]).toMatchObject({
        order_display_id: 'ORD-001',
        milestone: 'Delivered',
        completed: false,
        sort_order: 60,
      });
      expect(timeline[7].milestone_time).toBeNull();
    });

    it('inserts milestones in sort_order order', async () => {
      await service.createOrderTimeline('ORD-002');
      const sortOrders = m.store.order_timeline.map(t => t.sort_order);
      expect(sortOrders).toEqual([10, 20, 30, 35, 40, 50, 55, 60]);
    });

    it('throws DomainError when insert fails', async () => {
      m.programError('db failure');
      await expect(service.createOrderTimeline('ORD-003')).rejects.toThrow(DomainError);
    });
  });

  describe('getOrderTimeline', () => {
    it('returns empty array when no timeline exists', async () => {
      const result = await service.getOrderTimeline('NONEXISTENT');
      expect(result).toEqual([]);
    });

    it('returns milestones ordered by sort_order', async () => {
      m.store.order_timeline.push(
        { order_display_id: 'ORD-001', milestone: 'In Transit', milestone_time: null, completed: false, sort_order: 50 },
        { order_display_id: 'ORD-001', milestone: 'Order Placed', milestone_time: '2024-01-01T00:00:00Z', completed: true, sort_order: 10 },
      );

      const result = await service.getOrderTimeline('ORD-001');
      expect(result).toHaveLength(2);
      expect(result[0].sort_order).toBe(10);
      expect(result[1].sort_order).toBe(50);
    });

    it('throws DomainError on supabase error', async () => {
      m.programError('query failed');
      await expect(service.getOrderTimeline('ORD-001')).rejects.toThrow(DomainError);
    });
  });

  describe('completeMilestone', () => {
    it('marks milestone as completed with timestamp', async () => {
      m.store.order_timeline.push({ order_display_id: 'ORD-001', milestone: 'Truck Assigned', milestone_time: null, completed: false, sort_order: 20 });

      await service.completeMilestone('ORD-001', 'Truck Assigned');
      const entry = m.store.order_timeline[0];
      expect(entry.completed).toBe(true);
      expect(entry.milestone_time).toBeTruthy();
    });

    it('throws DomainError on update failure', async () => {
      m.store.order_timeline.push({ order_display_id: 'ORD-001', milestone: 'Truck Assigned', completed: false, sort_order: 20 });
      m.programError('update failed');
      await expect(service.completeMilestone('ORD-001', 'Truck Assigned')).rejects.toThrow(DomainError);
    });
  });

  describe('resetMilestone', () => {
    it('resets milestone to incomplete', async () => {
      m.store.order_timeline.push({ order_display_id: 'ORD-001', milestone: 'Truck Assigned', milestone_time: '2024-01-01T00:00:00Z', completed: true, sort_order: 20 });

      await service.resetMilestone('ORD-001', 'Truck Assigned');
      const entry = m.store.order_timeline[0];
      expect(entry.completed).toBe(false);
      expect(entry.milestone_time).toBeNull();
    });
  });

  describe('insertDropChangedEvent', () => {
    it('inserts a Drop Changed milestone at sort_order 25', async () => {
      await service.insertDropChangedEvent('ORD-001');
      const entry = m.store.order_timeline[0];
      expect(entry).toMatchObject({
        order_display_id: 'ORD-001',
        milestone: 'Drop Changed',
        completed: true,
        sort_order: 25,
      });
      expect(entry.milestone_time).toBeTruthy();
    });
  });

  describe('completeOrderPlacedMilestone', () => {
    it('completes the Order Placed milestone', async () => {
      m.store.order_timeline.push({ order_display_id: 'ORD-001', milestone: 'Order Placed', milestone_time: null, completed: false, sort_order: 10 });

      await service.completeOrderPlacedMilestone('ORD-001', '2024-06-01T00:00:00Z');
      const entry = m.store.order_timeline[0];
      expect(entry.completed).toBe(true);
      expect(entry.milestone_time).toBe('2024-06-01T00:00:00Z');
    });

    it('uses current time when no timestamp provided', async () => {
      m.store.order_timeline.push({ order_display_id: 'ORD-001', milestone: 'Order Placed', milestone_time: null, completed: false, sort_order: 10 });
      const before = new Date().toISOString();

      await service.completeOrderPlacedMilestone('ORD-001');
      const entry = m.store.order_timeline[0];
      expect(entry.completed).toBe(true);
      expect(entry.milestone_time >= before).toBe(true);
    });
  });

  describe('deleteOrderTimeline', () => {
    it('deletes all timeline entries for a given order', async () => {
      m.store.order_timeline.push(
        { order_display_id: 'ORD-001', milestone: 'Order Placed', sort_order: 10 },
        { order_display_id: 'ORD-001', milestone: 'Truck Assigned', sort_order: 20 },
        { order_display_id: 'ORD-002', milestone: 'Order Placed', sort_order: 10 },
      );

      await service.deleteOrderTimeline('ORD-001');
      expect(m.store.order_timeline).toHaveLength(1);
      expect(m.store.order_timeline[0].order_display_id).toBe('ORD-002');
    });
  });
});
