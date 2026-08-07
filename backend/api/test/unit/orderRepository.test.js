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
