import { beforeEach, describe, expect, it } from 'vitest';

import { createSupabaseMock } from '../../helpers/supabaseMock.js';
import { OrderRepository } from '../../../src/repositories/orderRepository.js';

describe('OrderRepository stale-order cancellation', () => {
  let supabaseMock;
  let orderRepository;

  beforeEach(() => {
    supabaseMock = createSupabaseMock();
    orderRepository = new OrderRepository(supabaseMock.supabase);
  });

  it('findStalePendingOrders selects only pending, older-than-cutoff, non-funding orders in a bounded batch', async () => {
    supabaseMock.programData([]);

    const cutoff = '2024-01-01T00:00:00.000Z';
    await orderRepository.findStalePendingOrders(cutoff, 100);

    const call = supabaseMock.calls.find(c => c.table === 'orders' && c.mode === 'select');
    expect(call).toBeTruthy();
    expect(call.select).toBe('id');
    expect(call.filters).toEqual(expect.arrayContaining([
      { col: 'status', op: 'eq', val: 'pending' },
      { col: 'created_at', op: 'lt', val: cutoff },
      { col: 'escrow_status', op: 'neq', val: 'funding' },
    ]));
    expect(call.limit).toBe(100);
  });

  it('cancelStaleOrder calls the cancel_stale_order_tx RPC with the claim params', async () => {
    supabaseMock.programRpcError('boom');

    await orderRepository.cancelStaleOrder('order-1', 'Stale order: no accepted bid within 24 hours.', '2024-01-01T00:00:00.000Z');

    const rpcCall = supabaseMock.calls.find(c => c.rpc === 'cancel_stale_order_tx');
    expect(rpcCall).toBeTruthy();
    expect(rpcCall.args).toEqual({
      p_order_id: 'order-1',
      p_cancellation_reason: 'Stale order: no accepted bid within 24 hours.',
      p_stale_since: '2024-01-01T00:00:00.000Z',
    });
  });

  it('revertEscrowStatus only reverts from funding/funded (never clobbers refund states)', async () => {
    supabaseMock.store.orders = [
      { id: 'order-1', escrow_status: 'funded' },
      { id: 'order-2', escrow_status: 'refund_pending' },
    ];

    await orderRepository.revertEscrowStatus('order-1');
    await orderRepository.revertEscrowStatus('order-2');

    const updateCalls = supabaseMock.calls.filter(c => c.table === 'orders' && c.mode === 'update');
    expect(updateCalls).toHaveLength(2);
    for (const call of updateCalls) {
      expect(call.filters).toEqual(expect.arrayContaining([
        { col: 'escrow_status', op: 'in', val: ['funding', 'funded'] },
      ]));
    }
    expect(supabaseMock.store.orders[0].escrow_status).toBe('pending');
    expect(supabaseMock.store.orders[1].escrow_status).toBe('refund_pending');
  });
});
