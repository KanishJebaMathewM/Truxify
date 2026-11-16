import { describe, expect, it, vi } from 'vitest';
import { rebuildFromPages } from '../../../eventsourcing/rebuild-stream.js';
import { EventStoreCore } from '../../../eventsourcing/event-sourcing-core.js';
const row = (id, version, type, payload = {}) => ({ aggregate_id: id, version, event_type: type, payload, event_id: `${id}-${version}` });
async function* pages(...batches) { yield* batches; }
function options(orderPages, driverPages = pages()) {
  return { orderPages, driverPages, getSnapshot: vi.fn(async () => null), writeOrder: vi.fn(async () => {}), writeDriver: vi.fn(async () => {}) };
}
describe('bounded projection rebuild', () => {
  it('folds an aggregate across pages and matches snapshot-aware legacy replay', async () => {
    const events = [row('a', 1, 'ORDER_CREATED', { customerId: 'old' }), row('a', 2, 'ORDER_UPDATED', { amount: 100 }), row('a', 3, 'DRIVER_ASSIGNED', { driverId: 'driver' }), row('a', 4, 'ORDER_UPDATED', { amount: 200 })];
    const snapshot = { version: 2, state: { id: 'a', customerId: 'saved', amount: 100, status: 'CREATED', version: 2 } };
    const args = options(pages(events.slice(0, 2), events.slice(2)));
    args.getSnapshot.mockResolvedValue(snapshot);
    const core = new EventStoreCore({ db: {} });
    core.getSnapshot = async () => snapshot;
    const expected = await core.rebuildFromRows('a', events);
    const counts = await rebuildFromPages(args);
    expect(args.writeOrder).toHaveBeenCalledExactlyOnceWith('a', expected, 'ORDER_UPDATED', 4);
    expect(args.getSnapshot).toHaveBeenCalledTimes(1);
    expect(counts).toEqual({ aggregates: 1, orderCount: 1, driverCount: 0, eventCount: 4 });
  });
  it('writes completed aggregates before fetching more history', async () => {
    const args = options(null);
    args.orderPages = (async function* () {
      yield [row('a', 1, 'ORDER_CREATED'), row('b', 1, 'ORDER_CREATED')];
      expect(args.writeOrder.mock.calls.map(([id]) => id)).toEqual(['a']);
      yield [row('b', 2, 'ORDER_UPDATED', { amount: 123 })];
      expect(args.writeOrder).toHaveBeenCalledTimes(1);
      yield [row('c', 1, 'ORDER_CREATED')];
      expect(args.writeOrder.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    })();
    expect(await rebuildFromPages(args)).toEqual({ aggregates: 3, orderCount: 3, driverCount: 0, eventCount: 4 });
  });
  it('keeps driver projections in supplied global chronology across aggregates', async () => {
    const earlier = row('z', 2, 'DRIVER_ASSIGNED', { driverId: 'same', orderId: 'z' });
    const later = row('a', 2, 'DRIVER_ASSIGNED', { driverId: 'same', orderId: 'a' });
    const args = options(pages([row('a', 1, 'ORDER_CREATED'), later, row('z', 1, 'ORDER_CREATED'), earlier]), pages([earlier], [later]));
    const counts = await rebuildFromPages(args);
    expect(args.writeDriver.mock.calls.map(([event]) => event.payload.orderId)).toEqual(['z', 'a']);
    expect(counts.driverCount).toBe(2);
  });
  it('does not overwrite snapshot state with older rows', async () => {
    const args = options(pages([row('a', 1, 'ORDER_CREATED', { amount: 1 })]));
    args.getSnapshot.mockResolvedValue({ version: 4, state: { id: 'a', version: 4, amount: 999 } });
    await rebuildFromPages(args);
    expect(args.writeOrder).toHaveBeenCalledWith('a', { id: 'a', version: 4, amount: 999 }, 'ORDER_CREATED', 4);
  });
  it('awaits projection persistence before consuming the next page', async () => {
    const args = options(pages([row('a', 1, 'ORDER_CREATED'), row('b', 1, 'ORDER_CREATED')]));
    args.writeOrder.mockRejectedValue(new Error('write failed'));
    await expect(rebuildFromPages(args)).rejects.toThrow('write failed');
    expect(args.getSnapshot).toHaveBeenCalledTimes(1);
    expect(args.writeDriver).not.toHaveBeenCalled();
  });
  it('handles an empty event store without producing projections', async () => {
    const args = options(pages([]));
    expect(await rebuildFromPages(args)).toEqual({ aggregates: 0, orderCount: 0, driverCount: 0, eventCount: 0 });
    expect(args.writeOrder).not.toHaveBeenCalled();
    expect(args.getSnapshot).not.toHaveBeenCalled();
  });
});
