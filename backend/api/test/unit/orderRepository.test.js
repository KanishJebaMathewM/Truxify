/**
 * Unit tests for backend/api/src/repositories/orderRepository.js
 *
 * Coverage:
 *   - findOrderByIdOrDisplayId resolves a UUID via findOrderById
 *   - findOrderByIdOrDisplayId resolves a display id via findOrderByDisplayId
 *   - findOrderByIdOrDisplayId delegates to findOrderByAnyId
 *
 * Run with:  npm test -- test/unit/orderRepository.test.js
 */
import { describe, it, expect, vi } from 'vitest';
import { OrderRepository } from '../../src/repositories/orderRepository.js';

vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({
  default: {
    getActiveSpan: vi.fn(() => ({
      setAttributes: vi.fn(),
    })),
    startWorkerSpan: vi.fn(() => ({
      setAttributes: vi.fn(),
    })),
    end: vi.fn(),
  },
}));

function buildStubSupabase(rowByQuery) {
  return {
    from: vi.fn((table) => {
      if (table !== 'orders') {
        throw new Error(`Unexpected table "${table}"`);
      }
      return {
        select: vi.fn((columns) => ({
          eq: vi.fn((column, value) => ({
            maybeSingle: vi.fn(() => {
              const row = rowByQuery[`${column}:${value}`];
              return Promise.resolve(row ?? { data: null, error: null });
            }),
          })),
        })),
      };
    }),
  };
}

const UUID = '11111111-2222-3333-4444-555555555555';
const DISPLAY_ID = '#FF20260521';

describe('OrderRepository.findOrderByIdOrDisplayId', () => {
  it('resolves a UUID order id through findOrderById', async () => {
    const supabase = buildStubSupabase({
      [`id:${UUID}`]: { data: { id: UUID, order_display_id: DISPLAY_ID }, error: null },
    });
    const repo = new OrderRepository(supabase);

    const result = await repo.findOrderByIdOrDisplayId(UUID, 'id, order_display_id');

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: UUID, order_display_id: DISPLAY_ID });
  });

  it('resolves a display id through findOrderByDisplayId', async () => {
    const supabase = buildStubSupabase({
      [`order_display_id:${DISPLAY_ID}`]: { data: { id: UUID, order_display_id: DISPLAY_ID }, error: null },
    });
    const repo = new OrderRepository(supabase);

    const result = await repo.findOrderByIdOrDisplayId(DISPLAY_ID, 'id, order_display_id');

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: UUID, order_display_id: DISPLAY_ID });
  });

  it('returns null when the order is not found by either id', async () => {
    const supabase = buildStubSupabase({});
    const repo = new OrderRepository(supabase);

    const result = await repo.findOrderByIdOrDisplayId('missing-order', 'id');

    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
  });

  it('delegates to findOrderByAnyId for the lookup', async () => {
    const supabase = buildStubSupabase({
      [`id:${UUID}`]: { data: { id: UUID, order_display_id: DISPLAY_ID }, error: null },
    });
    const repo = new OrderRepository(supabase);
    const spy = vi.spyOn(repo, 'findOrderByAnyId');

    await repo.findOrderByIdOrDisplayId(UUID, 'id');

    expect(spy).toHaveBeenCalledWith(UUID, 'id');
  });
});

describe('OrderRepository.updateOrderWithFilter', () => {
  function buildUpdateStub({ calls, result }) {
    return {
      from: vi.fn(() => {
        const chain = {
          eq(column, value) {
            calls.push({ op: 'eq', column, value });
            return chain;
          },
          neq(column, value) {
            calls.push({ op: 'neq', column, value });
            return chain;
          },
          not(column, operator, value) {
            calls.push({ op: 'not', column, operator, value });
            return chain;
          },
          in(column, value) {
            calls.push({ op: 'in', column, value });
            return chain;
          },
          select() { return chain; },
          single() { return chain; },
          then(resolve) { return Promise.resolve(resolve(result)); },
        };
        return {
          update: vi.fn(() => chain),
        };
      }),
    };
  }

  it('applies a neq filter to the update query', async () => {
    const calls = [];
    const supabase = buildUpdateStub({
      calls,
      result: { data: { id: UUID, escrow_status: 'funded' }, error: null },
    });
    const repo = new OrderRepository(supabase);

    const result = await repo.updateOrderWithFilter(
      UUID,
      { escrow_status: 'funded' },
      [{ op: 'neq', column: 'escrow_status', value: 'funded' }],
    );

    expect(result.error).toBeNull();
    expect(calls).toEqual([
      { op: 'eq', column: 'id', value: UUID },
      { op: 'neq', column: 'escrow_status', value: 'funded' },
    ]);
  });
});

describe('OrderRepository.findStaleFundingOrders', () => {
  function buildFundingStub(trace) {
    const builder = {
      select() { return this; },
      eq() { return this; },
      not() { return this; },
      or() { return this; },
      gt(column, value) { trace.gt = [column, value]; return this; },
      order(column, opts) { trace.order = [...(trace.order || []), [column, opts]]; return this; },
      limit(value) { trace.limit = value; return this; },
      then(resolve) { return resolve({ data: [], error: null }); },
    };
    return { from: vi.fn(() => builder) };
  }

  it('applies a deterministic order and a page-size limit', async () => {
    const trace = {};
    const repo = new OrderRepository(buildFundingStub(trace));

    await repo.findStaleFundingOrders('2026-01-01T00:00:00.000Z');

    expect(trace.order).toEqual([
      ['updated_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(trace.limit).toBe(1000);
  });

  it('adds an updated_at cursor filter when after is provided', async () => {
    const trace = {};
    const repo = new OrderRepository(buildFundingStub(trace));

    await repo.findStaleFundingOrders('2026-01-01T00:00:00.000Z', { after: '2026-02-01T00:00:00.000Z' });

    expect(trace.gt).toEqual(['updated_at', '2026-02-01T00:00:00.000Z']);
  });
});

describe('OrderRepository truck lookup null guards', () => {
  const TRUCK_UUID = '99999999-8888-7777-6666-555555555555';

  function buildTruckStub() {
    const calls = [];
    return {
      calls,
      supabase: {
        from: vi.fn(() => {
          calls.push('from');
          return {
            select: vi.fn(() => {
              calls.push('select');
              return {
                eq: vi.fn(() => {
                  calls.push('eq');
                  return { maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })) };
                }),
                in: vi.fn(() => {
                  calls.push('in');
                  return Promise.resolve({ data: [], error: null });
                }),
              };
            }),
          };
        }),
      },
    };
  }

  it('findTruckById returns null without querying the database for a null id', async () => {
    const { calls, supabase } = buildTruckStub();
    const repo = new OrderRepository(supabase);

    const nullResult = await repo.findTruckById(null);
    const undefinedResult = await repo.findTruckById(undefined);

    expect(nullResult).toEqual({ data: null, error: null });
    expect(undefinedResult).toEqual({ data: null, error: null });
    expect(calls).toEqual([]);
  });

  it('findTruckById queries the database for a valid id', async () => {
    const { calls, supabase } = buildTruckStub();
    const repo = new OrderRepository(supabase);

    await repo.findTruckById(TRUCK_UUID, 'id, name');

    expect(calls).toEqual(['from', 'select', 'eq']);
  });

  it('findTruckWithDetails returns null without querying the database for a null id', async () => {
    const { calls, supabase } = buildTruckStub();
    const repo = new OrderRepository(supabase);

    const result = await repo.findTruckWithDetails(null);

    expect(result).toEqual({ data: null, error: null });
    expect(calls).toEqual([]);
  });

  it('findTrucksByIds returns an empty list without querying for empty ids', async () => {
    const { calls, supabase } = buildTruckStub();
    const repo = new OrderRepository(supabase);

    const emptyResult = await repo.findTrucksByIds([]);
    const nullResult = await repo.findTrucksByIds(null);

    expect(emptyResult).toEqual({ data: [], error: null });
    expect(nullResult).toEqual({ data: [], error: null });
    expect(calls).toEqual([]);
  });

  it('findTrucksByIds queries the database for a non-empty id list', async () => {
    const { calls, supabase } = buildTruckStub();
    const repo = new OrderRepository(supabase);

    await repo.findTrucksByIds([TRUCK_UUID]);

    expect(calls).toEqual(['from', 'select', 'in']);
  });
});

describe('OrderRepository.updateOrder transactional outbox (#11215)', () => {
  const ORDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('routes through order_update_with_outbox RPC when eventType is provided', async () => {
    let rpcCalled = false;
    let rpcArgs = null;

    const mockClient = {
      rpc: vi.fn((name, params) => {
        if (name === 'order_update_with_outbox') {
          rpcCalled = true;
          rpcArgs = params;
          return {
            single: vi.fn().mockResolvedValue({
              data: { id: ORDER_ID, status: 'delivered', order_display_id: '#ORD-100' },
              error: null,
            }),
          };
        }
        throw new Error(`Unexpected RPC ${name}`);
      }),
      from: vi.fn(),
    };

    const repo = new OrderRepository(mockClient);
    const updates = { status: 'delivered' };

    const result = await repo.updateOrder(ORDER_ID, updates, 'ORDER_DELIVERED', 'idemp-key-1');

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ id: ORDER_ID, status: 'delivered' });
    expect(rpcCalled).toBe(true);
    expect(rpcArgs).toEqual({
      p_order_id: ORDER_ID,
      p_updates: updates,
      p_event_type: 'ORDER_DELIVERED',
      p_payload: {
        orderId: ORDER_ID,
        status: 'delivered',
        updates,
      },
      p_idempotency_key: 'idemp-key-1',
    });
    // Verifies no separate non-atomic from('orders') update was called
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('aborts atomically and produces no event when RPC fails / simulated crash', async () => {
    const mockClient = {
      rpc: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'transaction aborted: simulated node crash / dead-letter constraint', code: '40001' },
        }),
      })),
      from: vi.fn(),
    };

    const repo = new OrderRepository(mockClient);
    const result = await repo.updateOrder(ORDER_ID, { status: 'cancelled' }, 'ORDER_CANCELLED');

    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain('simulated node crash');
    // Ensure no fallback or separate writes occurred
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('uses standard direct table update when eventType is null', async () => {
    let fromCalled = false;
    let updateCalled = false;

    const mockChain = {
      update: vi.fn(() => mockChain),
      eq: vi.fn(() => mockChain),
      select: vi.fn(() => mockChain),
      single: vi.fn().mockResolvedValue({
        data: { id: ORDER_ID, status: 'in_transit' },
        error: null,
      }),
    };

    const mockClient = {
      rpc: vi.fn(),
      from: vi.fn((table) => {
        if (table === 'orders') {
          fromCalled = true;
          return mockChain;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const repo = new OrderRepository(mockClient);
    const result = await repo.updateOrder(ORDER_ID, { status: 'in_transit' });

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ id: ORDER_ID, status: 'in_transit' });
    expect(fromCalled).toBe(true);
    expect(mockClient.rpc).not.toHaveBeenCalled();
  });

  it('never falls back to direct table update when eventType is provided even on missing-RPC PGRST202 error', async () => {
    const mockClient = {
      rpc: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'function order_update_with_outbox does not exist', code: 'PGRST202' },
        }),
      })),
      from: vi.fn(),
    };

    const repo = new OrderRepository(mockClient);
    const result = await repo.updateOrder(ORDER_ID, { status: 'cancelled' }, 'ORDER_CANCELLED');

    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe('PGRST202');
    // Ensure no fallback occurred to preserve transactional-only guarantees
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  describe('findStaleFundingOrders composite cursor', () => {
    it('applies composite or filter when after contains updated_at and id', async () => {
      const mockChain = {
        select: vi.fn(() => mockChain),
        eq: vi.fn(() => mockChain),
        not: vi.fn(() => mockChain),
        or: vi.fn(() => mockChain),
        order: vi.fn(() => mockChain),
        limit: vi.fn(() => mockChain),
      };

      const mockClient = {
        from: vi.fn(() => mockChain),
      };

      const repo = new OrderRepository(mockClient);
      const cutoff = '2026-09-17T00:00:00.000Z';
      const cursor = { updated_at: '2026-09-17T01:00:00.000Z', id: '11111111-2222-3333-4444-555555555555' };

      await repo.findStaleFundingOrders(cutoff, { after: cursor, limit: 100 });

      expect(mockChain.or).toHaveBeenCalledWith(
        `updated_at.gt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.gt.${cursor.id})`
      );
    });
  });
});
