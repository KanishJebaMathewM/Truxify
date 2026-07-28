import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
const handlerMock = vi.fn();

function makeBuilder(table) {
  const builder = {
    table,
    mode: 'select',
    selectColumns: '*',
    payload: null,
    filters: [],
    select(columns = '*') {
      this.mode = this.mode ?? 'select';
      this.selectColumns = columns;
      return this;
    },
    update(payload) {
      this.mode = 'update';
      this.payload = payload;
      return this;
    },
    eq(column, value) {
      this.filters.push({ column, value });
      return this;
    },
    lte() { return this; },
    in() { return this; },
    order() { return this; },
    limit() { return this; },
    then(resolve) {
      calls.push({
        table: this.table,
        mode: this.mode,
        select: this.selectColumns,
        payload: this.payload,
        filters: this.filters,
      });

      if (this.mode === 'select') {
        return resolve({
          data: [{ id: 'dlq-1' }],
          error: null,
        });
      }

      if (this.mode === 'update' && this.payload?.status === 'processing') {
        return resolve({
          data: [{
            id: 'dlq-1',
            provider: 'escrow',
            event_type: 'EscrowRefunded',
            payload: { orderId: 'order-1' },
            retry_count: 0,
          }],
          error: null,
        });
      }

      return resolve({ data: [], error: null });
    },
  };

  return builder;
}

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: vi.fn(makeBuilder),
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('dlqService', () => {
  beforeEach(() => {
    calls.length = 0;
    handlerMock.mockReset();
  });

  it('claims every field needed to dispatch a pending webhook failure', async () => {
    const { dlqService } = await import('../../src/services/webhook/dlqService.js');

    await dlqService.processQueue({ escrow: handlerMock });

    const claimCall = calls.find(call => call.mode === 'update' && call.payload?.status === 'processing');
    expect(claimCall.select).toBe('id, provider, event_type, payload, retry_count');
    expect(handlerMock).toHaveBeenCalledWith('EscrowRefunded', { orderId: 'order-1' });
  });
});
