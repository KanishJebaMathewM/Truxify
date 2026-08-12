import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { supabase: { from: vi.fn() } },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return dbMock.supabase; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { OrderValidationService } from '../../src/services/order/orderValidationService.js';
import { DomainError } from '../../src/services/order/domainError.js';

function makeService() {
  return new OrderValidationService({ supabase: dbMock.supabase, logger: { error: vi.fn() } });
}

describe('OrderValidationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assertOrderStatus', () => {
    it('passes when the status is allowed', () => {
      const svc = makeService();
      expect(() => svc.assertOrderStatus({ status: 'in_transit' }, ['in_transit', 'picked_up'])).not.toThrow();
    });

    it('throws DomainError 409 when the status is not allowed', () => {
      const svc = makeService();
      try {
        svc.assertOrderStatus({ status: 'delivered' }, ['in_transit']);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(DomainError);
        expect(e.status).toBe(409);
      }
    });
  });

  describe('assertNotTerminalStatus', () => {
    it('throws for terminal statuses', () => {
      const svc = makeService();
      for (const status of ['delivered', 'cancelled', 'payment_released']) {
        expect(() => svc.assertNotTerminalStatus({ status })).toThrow(DomainError);
      }
    });

    it('passes for active statuses', () => {
      const svc = makeService();
      expect(() => svc.assertNotTerminalStatus({ status: 'pending' })).not.toThrow();
    });
  });

  describe('assertEscrowState', () => {
    it('throws when the escrow state is not allowed', () => {
      const svc = makeService();
      try {
        svc.assertEscrowState({ escrow_status: 'released' }, ['funded']);
        expect.unreachable();
      } catch (e) {
        expect(e.status).toBe(400);
      }
    });

    it('passes when the escrow state is allowed', () => {
      const svc = makeService();
      expect(() => svc.assertEscrowState({ escrow_status: 'funded' }, ['funded'])).not.toThrow();
    });
  });

  describe('assertHasWeight', () => {
    it('throws when weight_tonnes is missing', () => {
      const svc = makeService();
      expect(() => svc.assertHasWeight({})).toThrow(DomainError);
    });

    it('passes when weight_tonnes is present', () => {
      const svc = makeService();
      expect(() => svc.assertHasWeight({ weight_tonnes: 5 })).not.toThrow();
    });
  });

  describe('assertRatingDeliverable', () => {
    it('throws when the order is not delivered', () => {
      const svc = makeService();
      expect(() => svc.assertRatingDeliverable({ status: 'in_transit', driver_id: 'd1' })).toThrow(DomainError);
    });

    it('throws when there is no driver', () => {
      const svc = makeService();
      expect(() => svc.assertRatingDeliverable({ status: 'delivered', driver_id: null })).toThrow(DomainError);
    });

    it('passes when delivered with a driver', () => {
      const svc = makeService();
      expect(() => svc.assertRatingDeliverable({ status: 'delivered', driver_id: 'd1' })).not.toThrow();
    });
  });

  describe('assertMilestone helpers', () => {
    const timeline = [
      { milestone: 'accepted', completed: true, sort_order: 1 },
      { milestone: 'picked_up', completed: false, sort_order: 2 },
      { milestone: 'delivered', completed: false, sort_order: 3 },
    ];

    it('assertMilestoneInTimeline finds the milestone', () => {
      const svc = makeService();
      expect(svc.assertMilestoneInTimeline(timeline, 'picked_up').milestone).toBe('picked_up');
    });

    it('assertMilestoneInTimeline throws for unknown milestone', () => {
      const svc = makeService();
      expect(() => svc.assertMilestoneInTimeline(timeline, 'nope')).toThrow(DomainError);
    });

    it('assertMilestoneNotDuplicate throws for completed milestones', () => {
      const svc = makeService();
      expect(() => svc.assertMilestoneNotDuplicate({ milestone: 'accepted', completed: true })).toThrow(DomainError);
    });

    it('assertMilestoneSequence enforces ordering', () => {
      const svc = makeService();
      expect(() => svc.assertMilestoneSequence(timeline, 'picked_up', 1)).not.toThrow();
      expect(() => svc.assertMilestoneSequence(timeline, 'delivered', 1)).toThrow(DomainError);
    });
  });

  describe('findOrderByIdOrDisplayId', () => {
    it('strips TX- prefix and queries by id first', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValueOnce({ data: { id: 'o1' }, error: null }) })) })),
      });
      const svc = makeService();
      const result = await svc.findOrderByIdOrDisplayId('TX-o1');
      expect(result).toEqual({ id: 'o1' });
      expect(dbMock.supabase.from).toHaveBeenCalledWith('orders');
    });

    it('throws DomainError on query error', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }) })) })),
      });
      const svc = makeService();
      await expect(svc.findOrderByIdOrDisplayId('o1')).rejects.toBeInstanceOf(DomainError);
    });
  });

  describe('assertLoadOfferAvailable', () => {
    it('throws 410 when the load is claimed', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'l1', status: 'claimed', customer_id: 'c1' }, error: null }) })) })),
      });
      const svc = makeService();
      try {
        await svc.assertLoadOfferAvailable('l1');
        expect.unreachable();
      } catch (e) {
        expect(e.status).toBe(410);
      }
    });
  });
});
