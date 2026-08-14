/**
 * Unit tests for the order backfill/rebuild operation
 * (backend/kafka/scripts/backfill-orders.js).
 *
 * Covers Issue #1 backfill requirements:
 *   - backfill calls the idempotent backfill_order_events RPC
 *   - it reports orders / read models written / outbox events enqueued
 *   - the RPC itself is idempotent (guarded in SQL by not-exists per aggregate)
 *   - failures propagate so the operator sees the error
 *
 * Run with:  npm test -- test/backfill.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/src/config/db.js', () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { backfillOrderReadModels } from '../scripts/backfill-orders.js';
import { supabaseAdmin } from '../../api/src/config/db.js';

describe('backfillOrderReadModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes the idempotent backfill RPC and returns the summary', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: { orders: 42, read_models_written: 42, outbox_events_enqueued: 40 },
        error: null,
      }),
    };

    const result = await backfillOrderReadModels({ client });

    expect(client.rpc).toHaveBeenCalledWith('backfill_order_events');
    expect(result).toEqual({
      orders: 42,
      read_models_written: 42,
      outbox_events_enqueued: 40,
    });
  });

  it('uses the service-role client by default', async () => {
    supabaseAdmin.rpc.mockResolvedValue({
      data: { orders: 0, read_models_written: 0, outbox_events_enqueued: 0 },
      error: null,
    });

    await backfillOrderReadModels();

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('backfill_order_events');
  });

  it('throws when the RPC fails so the operator can detect the problem', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
    };

    await expect(backfillOrderReadModels({ client })).rejects.toThrow(/boom/);
  });

  it('normalizes an unexpected payload shape', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    const result = await backfillOrderReadModels({ client });
    expect(result).toEqual({ orders: 0, read_models_written: 0, outbox_events_enqueued: 0 });
  });
});
