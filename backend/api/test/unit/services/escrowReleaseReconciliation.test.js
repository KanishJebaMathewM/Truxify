import { describe, it, expect, vi, beforeEach } from 'vitest';
import reconciliationService from '../../../src/services/escrowReleaseReconciliation.js';
import { orderRepository } from '../../../src/repositories/orderRepository.js';

vi.mock('../../../src/repositories/orderRepository.js', () => ({
  orderRepository: {
    findById: vi.fn(),
    finalizeSettlement: vi.fn(),
  },
}));

describe('EscrowReleaseReconciliationService - Delivered Orders Fix (#15278)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip cancelled orders', async () => {
    orderRepository.findById.mockResolvedValueOnce({
      id: 'ord-1',
      order_display_id: 'TRX-100',
      status: 'cancelled',
      settlement_finalized: false,
    });

    await reconciliationService.reconcileOrder('ord-1');

    expect(orderRepository.finalizeSettlement).not.toHaveBeenCalled();
  });

  it('should skip delivered orders that are already settlement-finalized', async () => {
    orderRepository.findById.mockResolvedValueOnce({
      id: 'ord-2',
      order_display_id: 'TRX-101',
      status: 'delivered',
      settlement_finalized: true,
    });

    await reconciliationService.reconcileOrder('ord-2');

    expect(orderRepository.finalizeSettlement).not.toHaveBeenCalled();
  });

  it('should NOT skip delivered orders whose settlement is not yet finalized', async () => {
    orderRepository.findById.mockResolvedValueOnce({
      id: 'ord-3',
      order_display_id: 'TRX-102',
      status: 'delivered',
      settlement_finalized: false,
    });
    orderRepository.finalizeSettlement.mockResolvedValueOnce(true);

    await reconciliationService.reconcileOrder('ord-3');

    expect(orderRepository.finalizeSettlement).toHaveBeenCalledWith('ord-3');
  });
});
