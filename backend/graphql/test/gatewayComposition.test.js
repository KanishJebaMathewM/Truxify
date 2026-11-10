import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { graphql, printSchema } = createRequire(import.meta.url)('graphql');
import { RemoteGraphQLDataSource } from '@apollo/gateway';
vi.mock('../../api/src/config/db.js', () => ({ supabase: {} }));
vi.mock('../../api/src/middleware/logger.js', () => ({ default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import gateway from '../gateway/index.js';
import startOrderService from '../services/order.service.js';
import startDriverService from '../services/driver.service.js';
import startTripService from '../services/trip.service.js';
const servers = vi.hoisted(() => []);
vi.mock('@apollo/server', async original => {
  const actual = await original();
  return { ...actual, ApolloServer: class { constructor(options) { servers.push(options); } } };
});
vi.mock('@apollo/server/standalone', () => ({ startStandaloneServer: vi.fn(async () => ({ url: 'http://localhost:4004/' })) }));
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await gateway.gateway.stop(); });

describe('gateway federation composition', () => {
  it('lists exactly the implemented subgraphs and configurable URLs', () => {
    vi.stubEnv('ORDER_SERVICE_URL', 'http://orders.example/graphql');
    vi.stubEnv('DRIVER_SERVICE_URL', 'http://drivers.example/graphql');
    vi.stubEnv('TRIP_SERVICE_URL', 'http://trips.example/graphql');
    expect(gateway.getServices()).toEqual([
      { name: 'order', url: 'http://orders.example/graphql' },
      { name: 'driver', url: 'http://drivers.example/graphql' },
      { name: 'trip', url: 'http://trips.example/graphql' },
    ]);
  });
  it('loads a real Apollo gateway composed from the actual subgraph schemas', async () => {
    servers.length = 0;
    await startOrderService();
    await startDriverService();
    await startTripService();
    const schemas = {
      'http://localhost:4001/graphql': servers[0].schema,
      'http://localhost:4002/graphql': servers[1].schema,
      'http://localhost:4004/graphql': servers.at(-1).schema,
    };
    const calls = [];
    vi.spyOn(RemoteGraphQLDataSource.prototype, 'process').mockImplementation(async function ({ request }) {
      calls.push(this.url);
      const schema = schemas[this.url];
      if (!schema) throw new Error('Gateway attempted nonexistent service: ' + this.url);
      return graphql({ schema, source: request.query, variableValues: request.variables });
    });
    const { schema } = await gateway.gateway.load();
    expect(new Set(calls)).toEqual(new Set(Object.keys(schemas)));
    const fields = Object.keys(schema.getQueryType().getFields());
    expect(fields).toEqual(expect.arrayContaining(['order', 'driver', 'logisticsRoute']));
    expect(fields).not.toContain('payment');
    expect(fields).not.toContain('me');
    expect(printSchema(schema)).not.toContain('type Payment');
  });
});
