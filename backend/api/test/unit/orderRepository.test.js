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
