import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { db, query } = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), update: vi.fn(), single: vi.fn() };
  for (const method of ['select', 'eq', 'update']) query[method].mockReturnValue(query);
  return { query, db: { from: vi.fn(() => query) } };
});
vi.mock('../../api/src/config/db.js', () => ({ supabase: db }));
vi.mock('../../api/src/middleware/logger.js', () => ({ default: { info: vi.fn() } }));
vi.mock('../gateway/authContext.js', () => ({ createLoaders: vi.fn() }));
vi.mock('../shared/trustedIdentity.js', () => ({ resolveUserFromTrustedHeaders: vi.fn() }));
import { typeDefs, resolvers } from '../services/order.service.js';
// Resolve the GraphQL runtime from its owning workspace, where it is declared.
const requireGraphql = createRequire(new URL('../package.json', import.meta.url));
const { graphql } = requireGraphql('graphql');
const { buildSubgraphSchema } = requireGraphql('@apollo/federation');
const schema = buildSubgraphSchema({ typeDefs, resolvers });
const mutation = 'mutation($input: UpdateOrderInput!) { updateOrder(id: "order-one", input: $input) { id } }';
async function execute(input, user = { id: 'customer-one', role: 'customer' }) {
  return graphql({ schema, source: mutation, variableValues: { input }, contextValue: { user } });
}
describe('GraphQL customer order status authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.single.mockResolvedValue({ data: { id: 'order-one', customer_id: 'customer-one' }, error: null });
  });
  it.each(['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED', 'DISPUTED'])('rejects customer %s status changes before a database write', async status => {
    const result = await execute({ status });
    expect(result.errors?.[0].message).toMatch(/status.*REST|REST.*status/i);
    expect(db.from).not.toHaveBeenCalled();
    expect(query.update).not.toHaveBeenCalled();
  });
  it.each(['driver', 'CUSTOMER', 'dispatcher'])('rejects non-admin role %s as well', async role => {
    const result = await execute({ status: 'COMPLETED' }, { id: 'customer-one', role });
    expect(result.errors).toHaveLength(1);
    expect(query.update).not.toHaveBeenCalled();
  });
  it('preserves metadata-only edits and customer ownership filtering', async () => {
    const result = await execute({ pickup: { lat: 10, lng: 20, address: 'Pickup' } });
    expect(result.errors).toBeUndefined();
    expect(query.update.mock.calls[0][0]).toMatchObject({ pickup_lat: 10, pickup_lng: 20, pickup_address: 'Pickup' });
    expect(query.eq).toHaveBeenCalledWith('customer_id', 'customer-one');
    expect(JSON.parse(JSON.stringify(query.update.mock.calls[0][0]))).not.toHaveProperty('status');
  });
  it.each(['admin', 'ADMIN'])('retains existing trusted %s status updates', async role => {
    const result = await execute({ status: 'COMPLETED' }, { id: 'admin-one', role });
    expect(result.errors).toBeUndefined();
    expect(query.update.mock.calls[0][0].status).toBe('delivered');
    expect(query.eq).not.toHaveBeenCalledWith('customer_id', expect.anything());
  });
  it('still rejects unauthenticated callers', async () => {
    const result = await execute({ status: 'COMPLETED' }, null);
    expect(result.errors?.[0].message).toBe('Authentication required');
    expect(query.update).not.toHaveBeenCalled();
  });
});
