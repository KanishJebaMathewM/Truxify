import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// The service constructs its own consul client from env; we inject a mock
// after construction (documented pattern for this module's no-DI style).
process.env.CONSUL_HOST = '127.0.0.1';

const { default: ConsulServiceClass } = await import('../consul.service.js');
// module default is a singleton INSTANCE; the class isn't exported — build our own via prototype
const service = Object.create(Object.getPrototypeOf(ConsulServiceClass));
service.services = {};
service.serviceCache = new Map();
service.healthChecks = {};
service._healthInterval = null;
service._rrIndex = undefined;

function withMockConsul(calls) {
  service.consul = {
    agent: { service: { register: async (cfg) => { calls.push(['register', cfg]); }, deregister: async (id) => { calls.push(['deregister', id]); } } },
    catalog: { service: { nodes: async (name) => { calls.push(['nodes', name]); return calls.catalogNodes ?? []; } } },
    health: { service: async (name) => { calls.push(['health', name]); return calls.healthEntries ?? []; } },
  };
}

describe('ConsulService registration', () => {
  test('registerService stores the service and defaults the health check', async () => {
    const calls = [];
    withMockConsul(calls);
    const res = await service.registerService({ id: 'api-1', name: 'api', address: '10.0.0.1', port: 5000 });
    assert.equal(res.success, true);
    assert.equal(calls[0][0], 'register');
    assert.equal(calls[0][1].check.http, 'http://10.0.0.1:5000/health');
    assert.ok(service.services['api-1']);
  });

  test('deregisterService removes from the registry and cache', async () => {
    const calls = [];
    withMockConsul(calls);
    await service.registerService({ id: 'api-2', name: 'api', address: '10.0.0.2', port: 5000 });
    service.serviceCache.set('api_true', { data: [], timestamp: Date.now() });
    const res = await service.deregisterService('api-2');
    assert.equal(res.success, true);
    assert.ok(!service.services['api-2']);
    assert.ok(!service.serviceCache.has('api-2'));
  });

  test('registration failure propagates (caller must retry)', async () => {
    service.consul = { agent: { service: { register: async () => { throw new Error('consul down'); } } } };
    await assert.rejects(service.registerService({ id: 'x', name: 'x', address: 'a', port: 1 }), /consul down/);
  });
});

describe('ConsulService discovery', () => {
  const nodes = [
    { Service: { ID: 'a', Address: '10.0.0.1', Port: 5000, Tags: [], Meta: {} } },
    { Service: { ID: 'b', Address: '10.0.0.2', Port: 5000, Tags: [], Meta: {} } },
  ];

  test('healthyOnly filters to passing health checks', async () => {
    const calls = [];
    service.serviceCache.clear();
    withMockConsul(calls);
    calls.catalogNodes = nodes;
    calls.healthEntries = [
      { ...nodes[0], Checks: [{ Status: 'passing' }] },
      { ...nodes[1], Checks: [{ Status: 'critical' }] },
    ];
    const res = await service.discoverService('api', true);
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'a');
  });

  test('discovery failure returns an empty list (callers fall back)', async () => {
    service.consul = { catalog: { service: { nodes: async () => { throw new Error('unreachable'); } } } };
    service.serviceCache.clear();
    assert.deepEqual(await service.discoverService('api'), []);
  });

  test('30s cache serves repeat lookups without re-querying', async () => {
    const calls = [];
    withMockConsul(calls);
    calls.catalogNodes = nodes;
    calls.healthEntries = nodes.map((n) => ({ ...n, Checks: [{ Status: 'passing' }] }));
    service.serviceCache.clear();
    await service.discoverService('cached-svc');
    await service.discoverService('cached-svc');
    assert.equal(calls.filter((c) => c[0] === 'nodes').length, 1, 'second lookup served from cache');
  });

  test('getServiceAddress round-robins across healthy instances', async () => {
    const calls = [];
    withMockConsul(calls);
    calls.catalogNodes = nodes;
    calls.healthEntries = nodes.map((n) => ({ ...n, Checks: [{ Status: 'passing' }] }));
    service.serviceCache.clear();
    service._rrIndex = 0;
    const first = await service.getServiceAddress('rr-svc');
    const second = await service.getServiceAddress('rr-svc');
    assert.notEqual(first, second, 'consecutive calls hit different instances');
  });

  test('getServiceAddress returns null when nothing is healthy', async () => {
    service.consul = { catalog: { service: { nodes: async () => [] } }, health: { service: async () => [] } };
    service.serviceCache.clear();
    assert.equal(await service.getServiceAddress('empty-svc'), null);
  });
});
