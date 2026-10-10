import { beforeEach, describe, it, expect, vi } from 'vitest';

const { anonFrom } = vi.hoisted(() => {
  const anonFrom = vi.fn(() => {
    throw new Error('anon Supabase client must not access orders_read_model');
  });
  return { anonFrom };
});

vi.mock('../../api/src/config/db.js', () => ({
  supabase: { from: anonFrom },
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../repositories/event.repository.js', () => ({
  default: {},
}));

import { OrderReadModel } from '../cqrs/order.read.model.js';

describe('OrderReadModel service-role access (issue #9202)', () => {
  beforeEach(() => {
    anonFrom.mockClear();
  });

  it('uses the injected service client for protected read-model reads', async () => {
    const row = { order_id: 'order-9202', payload: { status: 'in_transit' } };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    const serviceClient = { from: vi.fn(() => chain) };
    const model = new OrderReadModel(serviceClient);

    await expect(model.getOrderReadModel('order-9202')).resolves.toEqual(row);
    expect(serviceClient.from).toHaveBeenCalledWith('orders_read_model');
    expect(anonFrom).not.toHaveBeenCalled();
  });

  it('uses the injected service client for protected read-model stats', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ count: 1, error: null }),
    };
    const serviceClient = { from: vi.fn(() => chain) };
    const model = new OrderReadModel(serviceClient);

    const stats = await model.getOrderStats();

    expect(stats.pending).toBe(1);
    expect(serviceClient.from).toHaveBeenCalledTimes(10);
    expect(serviceClient.from).toHaveBeenCalledWith('orders_read_model');
    expect(anonFrom).not.toHaveBeenCalled();
  });

  it('uses the injected service client for protected read-model writes', async () => {
    const row = {
      order_id: 'order-write-9202',
      payload: { status: 'in_transit' },
      event_type: 'TRIP_STARTED',
      version: 1,
      status: 'in_transit',
      timeline: [{ type: 'TRIP_STARTED' }],
      updated_at: '2026-09-13T15:30:00.000Z',
    };
    const chain = {
      upsert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    const serviceClient = { from: vi.fn(() => chain) };
    const model = new OrderReadModel(serviceClient);

    await expect(model.updateReadModel('order-write-9202', {
      status: 'in_transit',
      data: { status: 'in_transit' },
      timeline: [{ type: 'TRIP_STARTED' }],
    })).resolves.toEqual(row);

    expect(serviceClient.from).toHaveBeenCalledWith('orders_read_model');
    expect(chain.upsert).toHaveBeenCalledTimes(1);
    expect(anonFrom).not.toHaveBeenCalled();
  });
});
