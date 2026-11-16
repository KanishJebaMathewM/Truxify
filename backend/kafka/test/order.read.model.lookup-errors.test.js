import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  result: { data: null, error: null },
  from: vi.fn(),
}));

const query = {
  select: vi.fn(() => query),
  eq: vi.fn(() => query),
  maybeSingle: vi.fn(async () => mocks.result),
};

vi.mock('../../api/src/config/db.js', () => ({
  supabase: { from: mocks.from },
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { OrderReadModel } from '../cqrs/order.read.model.js';

describe('OrderReadModel.getOrderReadModel lookup errors', () => {
  let readModel;

  beforeEach(() => {
    mocks.from.mockReset().mockReturnValue(query);
    query.select.mockClear();
    query.eq.mockClear();
    query.maybeSingle.mockClear();
    mocks.result = { data: null, error: null };
    readModel = new OrderReadModel({ from: mocks.from, rpc: vi.fn() });
  });

  it('rebuilds only when the lookup confirms that no row exists', async () => {
    const rebuilt = { orderId: 'order-1', status: 'created' };
    const buildReadModel = vi.spyOn(readModel, 'buildReadModel').mockResolvedValue(rebuilt);

    await expect(readModel.getOrderReadModel('order-1')).resolves.toBe(rebuilt);

    expect(buildReadModel).toHaveBeenCalledOnce();
    expect(buildReadModel).toHaveBeenCalledWith('order-1');
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });

  it('propagates Supabase lookup errors instead of rebuilding', async () => {
    const databaseError = { code: '42501', message: 'permission denied' };
    mocks.result = { data: null, error: databaseError };
    const buildReadModel = vi.spyOn(readModel, 'buildReadModel');

    await expect(readModel.getOrderReadModel('order-2')).rejects.toBe(databaseError);

    expect(buildReadModel).not.toHaveBeenCalled();
  });
});
