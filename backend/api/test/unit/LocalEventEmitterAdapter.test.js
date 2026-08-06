import { describe, it, expect, vi } from 'vitest';
import { LocalEventEmitterAdapter } from '../../src/core/events/adapters/LocalEventEmitterAdapter.js';

describe('LocalEventEmitterAdapter', () => {
  it('publishes local events via eventBus', async () => {
    const mockBus = { emitSafe: vi.fn() };
    const adapter = new LocalEventEmitterAdapter(mockBus);

    await adapter.publish({ eventType: 'ORDER_CREATED', payload: { id: 'order-1' } });
    expect(mockBus.emitSafe).toHaveBeenCalledWith('ORDER_CREATED', { eventType: 'ORDER_CREATED', payload: { id: 'order-1' } });
  });
});
