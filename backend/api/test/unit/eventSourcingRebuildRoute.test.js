import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ from: vi.fn(), rebuild: vi.fn(), guard: vi.fn(() => (req, res, next) => next()) }));
vi.mock('../../../eventsourcing/event-store.js', () => ({ default: { rebuildProjectionsFromPages: state.rebuild, rebuildProjections: async rows => ({ eventCount: rows.length }) } }));
vi.mock('../../src/config/db.js', () => ({ supabase: { from: state.from } }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn() } }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: (req, res, next) => next(), requireRole: state.guard }));
import router from '../../../eventsourcing/routes.js';
const layer = router.stack.find(layer => layer.route?.path === '/eventsourcing/rebuild');
const handler = layer.route.stack.at(-1).handle;
const res = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); });
describe('projection rebuild route', () => {
  it('provides lazy bounded order and assignment pages with deterministic ordering', async () => {
    const queries = [];
    state.from.mockImplementation(() => {
      const query = { filters: [], orders: [], select: vi.fn().mockReturnThis(), eq(field, value) { this.filters.push([field, value]); return this; }, order(field) { this.orders.push(field); return this; }, range: vi.fn() };
      const fullPage = Array.from({ length: 1000 }, (_, i) => ({ event_id: String(i) }));
      query.range.mockResolvedValueOnce({ data: fullPage, error: null });
      queries.push(query);
      // A new query is built for each request page.
      if (queries.length === 2) query.range.mockReset().mockResolvedValue({ data: [{ event_id: 'last' }], error: null });
      if (queries.length === 3) query.range.mockReset().mockResolvedValue({ data: [], error: null });
      return query;
    });
    state.rebuild.mockImplementation(async (orderPages, driverPages) => {
      expect(state.from).not.toHaveBeenCalled();
      const iterator = orderPages[Symbol.asyncIterator]();
      expect((await iterator.next()).value).toHaveLength(1000);
      expect(queries).toHaveLength(1);
      expect((await iterator.next()).value).toHaveLength(1);
      expect((await iterator.next()).done).toBe(true);
      for await (const page of driverPages) expect(page).toHaveLength(0);
      return { eventCount: 1001 };
    });
    const response = res();
    await handler({}, response);
    expect(queries[0].orders).toEqual(['aggregate_id', 'version', 'event_id']);
    expect(queries[0].range).toHaveBeenCalledWith(0, 999);
    expect(queries[1].range).toHaveBeenCalledWith(1000, 1999);
    expect(queries[2].filters).toEqual([['event_type', 'DRIVER_ASSIGNED']]);
    expect(queries[2].orders).toEqual(['timestamp', 'event_id']);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, eventCount: 1001 }));
  });
  it('returns a sanitized failure when a later page fails', async () => {
    state.from.mockReturnValue({ select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ error: { message: 'private database detail' } }) });
    state.rebuild.mockImplementation(async (orderPages) => { for await (const page of orderPages) void page; });
    const response = res();
    await handler({}, response);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'Projection rebuild failed', code: 'EVENT_STORE_INTERNAL_ERROR' });
  });
});
