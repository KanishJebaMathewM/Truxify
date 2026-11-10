import test from 'node:test';
import assert from 'node:assert/strict';
import { KalmanFilter2D } from '../../src/services/gps/kalmanFilter.js';

const state = (filter) => Object.fromEntries(['lat', 'lng', 'vLat', 'vLng', 'pLat', 'pLng', 'lastTimestamp'].map(key => [key, filter[key]]));
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

// Independent scalar Bayesian update written as precision weighting, with unwrapped longitude.
function reference(previous, observation, r, q) {
  const [lat, lng, time, accuracy] = observation;
  if (!previous) return { lat, lng, vLat: 0, vLng: 0, p: 1, time, speed: 0 };
  const dt = (time - previous.time) / 1000;
  const variance = previous.p + q * dt;
  const measurement = Math.max(r, accuracy * accuracy / 4);
  const priorWeight = measurement / (variance + measurement);
  const measurementWeight = variance / (variance + measurement);
  const nextLat = (previous.lat + previous.vLat * dt) * priorWeight + lat * measurementWeight;
  const nextLng = (previous.lng + previous.vLng * dt) * priorWeight + lng * measurementWeight;
  const vLat = (nextLat - previous.lat) / dt;
  const vLng = (nextLng - previous.lng) / dt;
  const speed = Math.sqrt((vLat * 111320) ** 2 + (vLng * 111320 * Math.cos(nextLat * Math.PI / 180)) ** 2);
  return { lat: nextLat, lng: nextLng, vLat, vLng, p: variance * measurement / (variance + measurement), time, speed };
}

for (const [r, q] of [[4, 1.5], [1, 0], [10000, 0], [0.001, 2], [25, 100]]) {
  test(`native stationary/moving trajectory matches independent precision-weighted reference r${r} q${q}`, () => {
    const filter = new KalmanFilter2D({ measurementNoise: r, processNoise: q });
    let expected;
    let time = 0;
    for (let index = 0; index < 100; index++) {
      time += 1000;
      const observed = [20 + index * 0.00001 + Math.sin(index) * 0.000001, 70 + index * 0.00002 + Math.cos(index) * 0.000001, time, index % 17];
      expected = reference(expected, observed, r, q);
      const actual = filter.update(...observed);
      close(filter.lat, expected.lat);
      close(filter.lng, expected.lng);
      close(filter.pLat, expected.p, 1e-9);
      close(filter.vLat, expected.vLat, 1e-7);
      close(filter.vLng, expected.vLng, 1e-7);
      close(actual.lat, expected.lat, 5.1e-8);
      close(actual.lng, expected.lng, 5.1e-8);
      close(actual.speedMps, expected.speed, 0.006);
      assert.equal(filter.lastTimestamp, time);
    }
  });
}

for (const direction of [1, -1]) {
  for (const latitude of [0, 60, 85]) {
    test(`native short dateline crossing stays local direction${direction} latitude${latitude}`, () => {
      const filter = new KalmanFilter2D();
      filter.update(latitude, direction * 179.999, 0, 4);
      const actual = filter.update(latitude, -direction * 179.999, 1000, 4);
      const gain = 2.5 / 6.5;
      const displacement = direction * 0.002 * gain;
      close(filter.vLng, displacement, 1e-12);
      assert.ok(Math.abs(actual.lng) > 179.99);
      close(actual.speedMps, Math.abs(displacement) * 111320 * Math.cos(latitude * Math.PI / 180), 0.006);
      assert.ok(actual.speedMps < 300);
      close(actual.lat, latitude, 1e-8);
    });
  }
}

const invalid = [
  [NaN, 70, 2000, 4], [20, Infinity, 2000, 4], [91, 70, 2000, 4], [-91, 70, 2000, 4],
  [20, 181, 2000, 4], [20, -181, 2000, 4], ['20', 70, 2000, 4], [false, 70, 2000, 4],
  [20, 70, NaN, 4], [20, 70, -1, 4], [20, 70, 1.5, 4], [20, 70, '2000', 4],
  [20, 70, true, 4], [20, 70, 8640000000000001, 4],
  [20, 70, 2000, NaN], [20, 70, 2000, Infinity], [20, 70, 2000, -1],
  [20, 70, 2000, '4'], [20, 70, 2000, false], [20, 70, 2000, 1000001],
];
for (const [index, args] of invalid.entries()) {
  test(`invalid observation${index} cannot corrupt current or next native output`, () => {
    const filter = new KalmanFilter2D();
    const untouched = new KalmanFilter2D();
    filter.update(20, 70, 1000, 4);
    untouched.update(20, 70, 1000, 4);
    const before = state(filter);
    assert.throws(() => filter.update(...args));
    assert.deepEqual(state(filter), before);
    assert.deepEqual(filter.update(20.001, 70.001, 3000, 4), untouched.update(20.001, 70.001, 3000, 4));
  });
}

test('initial admission and explicit reset are atomic on invalid data', () => {
  const filter = new KalmanFilter2D();
  for (const args of invalid) {
    assert.throws(() => filter.init(...args));
    assert.equal(filter.lastTimestamp, null);
    assert.throws(() => filter.update(...args));
    assert.equal(filter.lastTimestamp, null);
  }
  filter.init(20, 70, 1000);
  const before = state(filter);
  assert.throws(() => filter.init(100, 70, 2000));
  assert.deepEqual(state(filter), before);
  filter.init(30, 80, 0, 0);
  assert.equal(filter.lastTimestamp, 0);
  assert.deepEqual(filter.update(30, 80, 0, 0), { lat: 30, lng: 80, vLat: 0, vLng: 0, speedMps: 0 });
});

test('backward and conflicting equal-time observations cannot rewrite the clock or uncertainty', () => {
  const filter = new KalmanFilter2D();
  filter.update(20, 70, 2000, 4);
  const before = state(filter);
  for (const args of [[21, 71, 1000, 4], [21, 70, 2000, 4], [20, 71, 2000, 4], [20, 70, 2000, 5]]) {
    assert.throws(() => filter.update(...args));
    assert.deepEqual(state(filter), before);
  }
});

test('exact duplicate is idempotent and returned receipts are independently owned', () => {
  const filter = new KalmanFilter2D();
  filter.update(20, 70, 0, 4);
  const receipt = filter.update(20.001, 70.001, 1000, 4);
  const before = state(filter);
  for (let index = 0; index < 100; index++) {
    assert.deepEqual(filter.update(20.001, 70.001, 1000, 4), receipt);
    assert.deepEqual(state(filter), before);
  }
  receipt.lat = NaN;
  receipt.vLng = Infinity;
  assert.deepEqual(state(filter), before);
  assert.throws(() => { filter.lat = NaN; }, TypeError);
  assert.throws(() => { filter.lastTimestamp = 0; }, TypeError);
  assert.deepEqual(state(filter), before);
});

test('configured measurement floor and zero process noise affect the actual native gain', () => {
  const filter = new KalmanFilter2D({ measurementNoise: 10000, processNoise: 0 });
  filter.update(0, 0, 0, 4);
  filter.update(0, 0.001, 1000, 4);
  assert.equal(filter.q, 0);
  assert.equal(filter.r, 10000);
  close(filter.lng, 0.001 / 10001, 1e-16);
  close(filter.pLng, 10000 / 10001);
});

test('positive millisecond delta is used rather than invented tenth-second elapsed time', () => {
  const filter = new KalmanFilter2D({ processNoise: 0 });
  filter.update(0, 0, 0, 4);
  filter.update(0, 0.001, 1, 4);
  close(filter.vLng, 0.2);
});

test('inadmissible candidate near pole leaves the prior complete receipt and allows reset', () => {
  const filter = new KalmanFilter2D();
  filter.update(89.9, 0, 0, 0);
  filter.update(90, 0, 1, 0);
  const before = state(filter);
  assert.throws(() => filter.update(90, 0, 1000, 0), /candidate state/);
  assert.deepEqual(state(filter), before);
  filter.init(89, 0, 1000, 0);
  assert.ok(Number.isFinite(filter.update(89, 0, 2000, 0).speedMps));
});

test('ambiguous antipodal and long longitude prediction do not publish state', () => {
  const filter = new KalmanFilter2D();
  filter.update(0, 0, 0, 4);
  assert.throws(() => filter.update(0, 180, 1000, 4), /antipodal/);
  assert.equal(filter.lastTimestamp, 0);
  filter.update(0, 10, 1000, 4);
  const before = state(filter);
  assert.throws(() => filter.update(0, 11, 100000, 4), /prediction/);
  assert.deepEqual(state(filter), before);
});

for (const config of [
  { measurementNoise: 0 }, { measurementNoise: -1 }, { measurementNoise: NaN },
  { measurementNoise: Infinity }, { measurementNoise: '4' }, { measurementNoise: false }, { measurementNoise: 1e12 + 1 },
  { processNoise: -1 }, { processNoise: NaN }, { processNoise: Infinity },
  { processNoise: '0' }, { processNoise: false }, { processNoise: 1e12 + 1 },
]) test(`invalid configuration ${JSON.stringify(config)} rejected before state exists`, () => assert.throws(() => new KalmanFilter2D(config)));

test('native default argument time remains a finite admitted integer', () => {
  const filter = new KalmanFilter2D();
  filter.init(0, 0);
  assert.ok(Number.isSafeInteger(filter.lastTimestamp));
  assert.ok(Number.isFinite(filter.update(0, 0).speedMps));
});

test('actual geofence evaluator keeps a filtered short dateline crossing inside the same fence', async () => {
  const { GeofenceEvaluator } = await import('../../src/services/gps/geofenceEvaluator.js');
  const geofence = new GeofenceEvaluator();
  geofence.registerGeofence({ id: 'dateline', lat: 0, lng: 180, radiusMeters: 1000 });
  const filter = new KalmanFilter2D();
  const first = filter.update(0, 179.999, 0, 4);
  assert.equal(geofence.evaluateLocation('private-test-trip', first.lat, first.lng)[0].eventType, 'GEOFENCE_ENTER');
  const next = filter.update(0, -179.999, 1000, 4);
  assert.deepEqual(geofence.evaluateLocation('private-test-trip', next.lat, next.lng), []);
});

test('extreme uneven observation cadence either admits a valid state or preserves the entire previous receipt', () => {
  const filter = new KalmanFilter2D();
  let time = 0;
  let accepted = 0;
  let rejected = 0;
  for (let index = 0; index < 100; index++) {
    time += index % 3 === 0 ? 1 : 5000;
    const before = state(filter);
    try {
      const receipt = filter.update(20 + index * 0.00001 + Math.sin(index) * 0.000001, 70 + index * 0.00002, time, index % 17);
      accepted++;
      assert.ok(Object.values(receipt).every(Number.isFinite));
      assert.ok(Math.abs(receipt.lat) <= 90 && Math.abs(receipt.lng) <= 180);
      assert.equal(filter.lastTimestamp, time);
    } catch (error) {
      assert.ok(error instanceof RangeError);
      rejected++;
      assert.deepEqual(state(filter), before);
    }
  }
  assert.ok(accepted > 0);
  assert.ok(rejected > 0, 'legacy scalar predictor is not a calibrated arbitrary-cadence tracking model');
});
