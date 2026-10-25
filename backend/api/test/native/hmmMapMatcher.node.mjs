import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { HmmMapMatcher } from '../../src/services/gps/hmmMapMatcher.js';
import { admitTrajectory, admitMatchResponse } from '../../src/services/gps/osrmMatchProtocol.js';

const points = () => [
  { lat: 20, lng: 70 }, { lat: 21, lng: 71 }, { lat: 22, lng: 72 },
];
const response = () => ({
  code: 'Ok', matchings: [{ confidence: 0 }, { confidence: 0.95 }],
  tracepoints: [
    { location: [70, 20], matchings_index: 0, name: 'first' },
    { location: [71, 21], matchings_index: 1, name: 'second' }, null,
  ],
});

async function fixture(t, handler, options = {}) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    handler(req, res, requests);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const matcher = new HmmMapMatcher({
    osrmBaseUrl: `http://127.0.0.1:${server.address().port}`, ...options,
  });
  t.after(async () => {
    matcher.breaker.destroy();
    for (const socket of sockets) socket.destroy();
    const closed = once(server, 'close');
    server.close();
    await closed;
  });
  return { matcher, requests };
}

function send(res, data) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function unmatched(result, expected, reason) {
  assert.equal(result.length, expected.length);
  result.forEach((point, index) => {
    assert.equal(point.lat, expected[index].lat);
    assert.equal(point.lng, expected[index].lng);
    assert.equal(point.confidence, 0);
    assert.equal(point.matched, false);
    assert.equal(point.source, 'input');
    assert.equal(point.reason, reason);
    assert.equal(point.matchingIndex, null);
  });
}

test('native split matching uses each referenced confidence including zero and null outlier', async (t) => {
  const { matcher, requests } = await fixture(t, (_req, res) => send(res, response()));
  const result = await matcher.matchTrajectory(points());
  assert.equal(result[0].confidence, 0);
  assert.equal(result[0].matched, true);
  assert.equal(result[0].matchingIndex, 0);
  assert.equal(result[1].confidence, 0.95);
  assert.equal(result[1].matchingIndex, 1);
  assert.equal(result[1].roadName, 'second');
  unmatched([result[2]], [points()[2]], 'outlier');
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0], 'http://local').searchParams.has('timestamps'), false);
});

test('native request preserves epoch zero, coordinates, observed timestamps and radius policy', async (t) => {
  const { matcher, requests } = await fixture(t, (_req, res) => send(res, response()));
  const trajectory = points().map((p, i) => ({ ...p, timestamp: i * 1000, accuracy: [0, 25, 80][i] }));
  await matcher.matchTrajectory(trajectory);
  const url = new URL(requests[0], 'http://local');
  assert.equal(url.searchParams.get('timestamps'), '0;1;2');
  assert.equal(url.searchParams.get('radiuses'), '15;25;50');
  assert.equal(url.pathname, '/match/v1/driving/70.000000,20.000000;71.000000,21.000000;72.000000,22.000000');
});

const invalidInputs = [
  null, {}, 'bad', Array(2), Array.from({ length: 101 }, () => ({ lat: 20, lng: 70 })),
  [{ lat: NaN, lng: 70 }], [{ lat: Infinity, lng: 70 }], [{ lat: 91, lng: 70 }],
  [{ lat: 20, lng: -181 }], [{ lat: '20', lng: 70 }], [{ lat: true, lng: 70 }],
  [{ lat: 20 }], [null], [{ lat: 20, lng: 70, timestamp: -1 }],
  [{ lat: 20, lng: 70, timestamp: 1.5 }], [{ lat: 20, lng: 70, timestamp: true }],
  [{ lat: 20, lng: 70, timestamp: Number.MAX_SAFE_INTEGER + 1 }],
  [{ lat: 20, lng: 70, accuracy: NaN }], [{ lat: 20, lng: 70, accuracy: -1 }],
  [{ lat: 20, lng: 70, accuracy: '4' }],
  [{ lat: 20, lng: 70, timestamp: 1000 }, { lat: 21, lng: 71 }],
  [{ lat: 20, lng: 70, timestamp: 1000 }, { lat: 21, lng: 71, timestamp: 0 }],
];
for (const [index, value] of invalidInputs.entries()) {
  test(`complete invalid input${index} is rejected before native HTTP`, async (t) => {
    const { matcher, requests } = await fixture(t, (_req, res) => send(res, response()));
    await assert.rejects(matcher.matchTrajectory(value));
    assert.equal(requests.length, 0);
    assert.equal(matcher.breaker.failureCount, 0);
  });
}

test('empty and single trajectory are owned unobserved output without HTTP', async (t) => {
  const { matcher, requests } = await fixture(t, (_req, res) => send(res, response()));
  assert.deepEqual(await matcher.matchTrajectory([]), []);
  const input = [{ lat: 0, lng: 0 }];
  const result = await matcher.matchTrajectory(input);
  unmatched(result, input, 'insufficient_points');
  result[0].lat = 40;
  assert.equal(input[0].lat, 0);
  assert.equal(requests.length, 0);
});

const malformed = [
  null, [], 'json string', { code: 'Ok' }, { code: 'NoRoute' },
  { ...response(), tracepoints: [] }, { ...response(), tracepoints: Array(4).fill(null) },
  { ...response(), matchings: [] }, { ...response(), matchings: [null] },
  { ...response(), matchings: [{ confidence: '0' }, { confidence: 0.95 }] },
  { ...response(), matchings: [{ confidence: -0.1 }, { confidence: 0.95 }] },
  { ...response(), matchings: [{ confidence: 1.1 }, { confidence: 0.95 }] },
];
for (const bad of [
  false, [], { location: [70, 20] }, { location: [70, 20], matchings_index: 2 },
  { location: [70, 20], matchings_index: -1 }, { location: [70, 20], matchings_index: 0.5 },
  { location: [70, 20], matchings_index: false }, { location: [70, 20], matchings_index: '0' },
  { location: [200, 20], matchings_index: 0 }, { location: [70, 100], matchings_index: 0 },
  { location: ['70', 20], matchings_index: 0 }, { location: [70, 20, 0], matchings_index: 0 },
  { location: [70, 20], matchings_index: 0, name: false },
  { location: [70, 20], matchings_index: 0, name: 'x'.repeat(513) },
]) malformed.push({ ...response(), tracepoints: [bad, null, null] });

for (const [index, payload] of malformed.entries()) {
  test(`malformed native provider${index} rejects whole protocol inside breaker`, async (t) => {
    const { matcher, requests } = await fixture(t, (_req, res) => send(res, payload));
    unmatched(await matcher.matchTrajectory(points()), points(), 'provider_unavailable');
    assert.equal(matcher.breaker.failureCount, 1);
    assert.equal(requests.length, 1);
  });
}

test('native NoMatch is an observed provider outcome, not matched coordinates', async (t) => {
  const { matcher } = await fixture(t, (_req, res) => send(res, { code: 'NoMatch' }));
  unmatched(await matcher.matchTrajectory(points()), points(), 'no_match');
  assert.equal(matcher.breaker.failureCount, 0);
});

test('native malformed JSON and HTTP error remain unobserved protocol failure', async (t) => {
  let calls = 0;
  const { matcher } = await fixture(t, (_req, res) => {
    calls += 1;
    if (calls === 1) { res.setHeader('Content-Type', 'application/json'); res.end('{'); }
    else { res.statusCode = 503; res.end('unavailable'); }
  });
  unmatched(await matcher.matchTrajectory(points()), points(), 'provider_unavailable');
  unmatched(await matcher.matchTrajectory(points()), points(), 'provider_unavailable');
  assert.equal(matcher.breaker.failureCount, 2);
});

test('native oversized response is rejected before whole decoded result publication', async (t) => {
  const { matcher } = await fixture(t, (_req, res) => send(res, { ...response(), padding: 'x'.repeat(512 * 1024) }));
  unmatched(await matcher.matchTrajectory(points()), points(), 'provider_unavailable');
  assert.equal(matcher.breaker.failureCount, 1);
});

test('five malformed native provider responses open the configured breaker', async (t) => {
  const { matcher, requests } = await fixture(t, (_req, res) => send(res, { code: 'Ok' }));
  assert.equal(matcher.breaker.resetTimeoutMs, 20000);
  for (let i = 0; i < 6; i += 1) unmatched(await matcher.matchTrajectory(points()), points(), 'provider_unavailable');
  assert.equal(requests.length, 5);
  assert.equal(matcher.breaker.getState(), 'OPEN');
});

test('native breaker abort signal closes outstanding Axios request', { timeout: 3000 }, async (t) => {
  let signalArrival;
  const arrived = new Promise((resolve) => { signalArrival = resolve; });
  let signalClose;
  const closed = new Promise((resolve) => { signalClose = resolve; });
  const { matcher } = await fixture(t, (_req, res) => {
    signalArrival(); res.once('close', signalClose);
  }, { timeoutMs: 1000 });
  matcher.breaker.requestTimeoutMs = 80;
  const result = matcher.matchTrajectory(points());
  await arrived;
  unmatched(await result, points(), 'provider_unavailable');
  await closed;
  assert.equal(matcher.breaker.timeoutCount, 1);
});

test('async caller mutation cannot rewrite owned fallback coordinates or timestamps', async (t) => {
  let respond;
  let markArrived;
  const arrived = new Promise((resolve) => { markArrived = resolve; });
  const { matcher } = await fixture(t, (_req, res) => { respond = () => send(res, { code: 'NoMatch' }); markArrived(); });
  const input = points().map((p, i) => ({ ...p, timestamp: i * 1000 }));
  const expected = structuredClone(input);
  const result = matcher.matchTrajectory(input);
  await arrived;
  input[0].lat = 77; input[0].timestamp = 99999; input.pop();
  respond();
  unmatched(await result, expected, 'no_match');
});

test('complete admission owns coordinates and matching output independently', () => {
  const input = points(); const owned = admitTrajectory(input);
  input[0].lat = 77;
  assert.equal(owned[0].lat, 20);
  const payload = response(); const result = admitMatchResponse(payload, owned);
  payload.tracepoints[0].location[1] = 55;
  assert.equal(result[0].lat, 20);
});

for (const options of [
  { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: 1.5 }, { timeoutMs: NaN },
  { timeoutMs: true }, { timeoutMs: 60001 }, { osrmBaseUrl: '' },
  { osrmBaseUrl: 'file:///tmp/osrm' }, { osrmBaseUrl: 'http://localhost/?key=x' },
]) test(`invalid configuration ${JSON.stringify(options)} rejects`, () => assert.throws(() => new HmmMapMatcher(options)));

test('direct admission rejects sparse matching arrays before publishing output', () => {
  const payload = response();
  payload.matchings = Array(2);
  assert.throws(() => admitMatchResponse(payload, admitTrajectory(points())), /matching must be an object/);
});
