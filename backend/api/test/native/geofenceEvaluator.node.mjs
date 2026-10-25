import test from 'node:test';
import assert from 'node:assert/strict';
import { GeofenceEvaluator, calculateHaversineDistanceMeters as distance, EARTH_RADIUS_METERS as radius } from '../../src/services/gps/geofenceEvaluator.js';
import { ProfitabilityScorer } from '../../src/services/routing/profitabilityScorer.js';

function oracle(lat1, lng1, lat2, lng2) {
  const vector = (lat, lng) => {
    const a = lat * Math.PI / 180; const b = lng * Math.PI / 180;
    return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)];
  };
  const a = vector(lat1, lng1); const b = vector(lat2, lng2);
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  return radius * Math.atan2(Math.hypot(...cross), dot);
}
const fence = (overrides = {}) => ({ id: 'fence', lat: 20, lng: 70, radiusMeters: 100, ...overrides });
const snapshot = evaluator => ({ fences: evaluator.geofences, trips: evaluator.tripStates });

test('native spherical distance agrees with independent vector-angle oracle on600 seeded pairs', () => {
  let seed = 71;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let index = 0; index < 600; index++) {
    const points = [random() * 180 - 90, random() * 360 - 180, random() * 180 - 90, random() * 360 - 180];
    const actual = distance(...points);
    assert.ok(Number.isFinite(actual) && actual >= 0 && actual <= Math.PI * radius);
    assert.ok(Math.abs(actual - oracle(...points)) < 1e-5);
    assert.equal(actual, distance(points[2], points[3], points[0], points[1]));
  }
});

for (const points of [
  [-78.69141861796379,139.72028566058725,78.69141861796379,-40.27971433941275],
  [0,0,0,180], [90,0,-90,0], [60,20,-60,-160],
  [45,30,-45,-149.9999999], [0,179.999,0,-179.999], [85,179.999,85,-179.999],
]) test(`native endpoint spherical pair ${points.join(',')} remains finite`, () => {
  const actual = distance(...points);
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - oracle(...points)) < 0.3);
});

for (const points of [[0,180,0,-180], [90,0,90,180], [-90,-20,-90,100], [20,70,20,70]]) {
  test(`geographically identical endpoint ${points.join(',')} has exact zero radius semantics`, () => assert.equal(distance(...points), 0));
}

const badCoordinates = [[NaN,70], [20,Infinity], [91,70], [-91,70], [20,181], [20,-181], ['20',70], [false,70], [null,70]];
for (const [index, point] of badCoordinates.entries()) {
  test(`invalid observation${index} cannot emit false EXIT or replay ENTER`, () => {
    const evaluator = new GeofenceEvaluator(); evaluator.registerGeofence(fence());
    assert.equal(evaluator.evaluateLocation('trip',20,70)[0].eventType,'GEOFENCE_ENTER');
    const before = snapshot(evaluator);
    assert.throws(() => evaluator.evaluateLocation('trip', ...point));
    assert.deepEqual(snapshot(evaluator),before);
    assert.deepEqual(evaluator.evaluateLocation('trip',20,70),[]);
    assert.throws(() => evaluator.evaluateLocation('new-trip', ...point));
    assert.equal(evaluator.tripStates.has('new-trip'),false);
    assert.throws(() => distance(...point,20,70));
    assert.throws(() => distance(20,70,...point));
  });
}

const invalidFences = [
  null, [], {}, fence({lat:NaN}), fence({lng:Infinity}), fence({lat:100}), fence({lng:200}),
  fence({id:''}), fence({id:' '}), fence({id:{}}), fence({id:false}), fence({id:-1}), fence({id:'x'.repeat(257)}),
  fence({radiusMeters:-1}), fence({radiusMeters:NaN}), fence({radiusMeters:Infinity}), fence({radiusMeters:'100'}),
  fence({radiusMeters:false}), fence({radiusMeters:Math.PI*radius+1}),
  fence({name:''}), fence({name:{}}), fence({name:'x'.repeat(513)}), fence({type:''}), fence({type:[]}), fence({type:'x'.repeat(65)}),
];
for (const [index, input] of invalidFences.entries()) {
  test(`invalid fence replacement${index} preserves all owned registrations and membership`, () => {
    const evaluator = new GeofenceEvaluator(); evaluator.registerGeofence(fence()); evaluator.evaluateLocation('trip',20,70);
    const before = snapshot(evaluator);
    assert.throws(() => evaluator.registerGeofence(input));
    assert.deepEqual(snapshot(evaluator),before);
    assert.deepEqual(evaluator.evaluateLocation('trip',20,70),[]);
  });
}

test('explicit zero radius stays zero and default500 is only absent radius', () => {
  const evaluator = new GeofenceEvaluator();
  evaluator.registerGeofence(fence({radiusMeters:0}));
  assert.equal(evaluator.geofences.get('fence').radiusMeters,0);
  assert.equal(evaluator.evaluateLocation('trip',20,70)[0].eventType,'GEOFENCE_ENTER');
  assert.equal(evaluator.evaluateLocation('trip',20.000001,70)[0].eventType,'GEOFENCE_EXIT');
  evaluator.registerGeofence(fence({radiusMeters:undefined}));
  assert.equal(evaluator.geofences.get('fence').radiusMeters,500);
});

test('mixed fence candidate transitions publish one shared timestamp and stable event keys', () => {
  const evaluator = new GeofenceEvaluator();
  evaluator.registerGeofence(fence({id:'a',lat:0,lng:0}));
  evaluator.registerGeofence(fence({id:'b',lat:0,lng:0.01}));
  assert.equal(evaluator.evaluateLocation('trip',0,0)[0].geofenceId,'a');
  const events = evaluator.evaluateLocation('trip',0,0.01);
  assert.deepEqual(events.map(event => [event.geofenceId,event.eventType]),[['a','GEOFENCE_EXIT'],['b','GEOFENCE_ENTER']]);
  assert.equal(events[0].timestamp,events[1].timestamp);
  assert.equal(new Date(events[0].timestamp).toISOString(),events[0].timestamp);
  assert.deepEqual(Object.keys(events[0]),['eventType','tripId','geofenceId','geofenceName','geofenceType','distanceMeters','timestamp']);
  assert.ok(events.every(event => Number.isFinite(event.distanceMeters)));
  assert.deepEqual(evaluator.tripStates.get('trip'),new Set(['b']));
  events[1].geofenceId='changed';
  assert.deepEqual(evaluator.evaluateLocation('trip',0,0.01),[]);
});

test('source configuration and defensive map/set views cannot mutate owned observations', () => {
  const evaluator = new GeofenceEvaluator(); const input=fence(); evaluator.registerGeofence(input); evaluator.evaluateLocation('trip',20,70);
  input.lat=NaN; input.name='mutated';
  const view=evaluator.geofences; view.get('fence').lat=NaN; view.clear();
  const memberships=evaluator.tripStates; memberships.get('trip').clear(); memberships.clear();
  assert.deepEqual(evaluator.evaluateLocation('trip',20,70),[]);
  assert.equal(evaluator.geofences.get('fence').lat,20);
  assert.equal(evaluator.geofences.get('fence').name,'Geofence Perimeter');
});

test('bounded fence/trip ownership rejects admission without evicting live records; explicit cleanup recovers', () => {
  const evaluator = new GeofenceEvaluator({maxGeofences:1,maxTrips:1}); evaluator.registerGeofence(fence()); evaluator.evaluateLocation('one',20,70);
  const before=snapshot(evaluator);
  assert.throws(() => evaluator.registerGeofence(fence({id:'two'})),/capacity/);
  assert.throws(() => evaluator.evaluateLocation('two',20,70),/capacity/);
  assert.deepEqual(snapshot(evaluator),before);
  evaluator.registerGeofence(fence({name:'replacement'}));
  assert.deepEqual(evaluator.evaluateLocation('one',20,70),[]);
  evaluator.clearTrip('one'); assert.equal(evaluator.tripStates.size,0);
  assert.equal(evaluator.evaluateLocation('two',20,70)[0].eventType,'GEOFENCE_ENTER');
  assert.equal(evaluator.removeGeofence('fence'),true); assert.equal(evaluator.removeGeofence('fence'),false);
  assert.deepEqual(evaluator.tripStates.get('two'),new Set());
  evaluator.registerGeofence(fence({id:'next'}));
  assert.equal(evaluator.evaluateLocation('two',20,70)[0].geofenceId,'next');
});

for (const id of ['', ' ', ' padded ', {}, [], true, NaN, -1, 1.5, 'x'.repeat(257)]) {
  test(`invalid identifier ${JSON.stringify(id)} leaves native ownership untouched`, () => {
    const evaluator = new GeofenceEvaluator(); evaluator.registerGeofence(fence()); evaluator.evaluateLocation('trip',20,70);
    const before=snapshot(evaluator);
    assert.throws(() => evaluator.evaluateLocation(id,20,70));
    assert.throws(() => evaluator.clearTrip(id));
    assert.throws(() => evaluator.removeGeofence(id));
    assert.deepEqual(snapshot(evaluator),before);
  });
}
for (const bad of [0,-1,1.5,NaN,Infinity,'1',false,1000001]) {
  test(`invalid capacity ${JSON.stringify(bad)} rejected`, () => {
    assert.throws(() => new GeofenceEvaluator({maxTrips:bad}));
    assert.throws(() => new GeofenceEvaluator({maxGeofences:bad}));
  });
}

test('native numeric zero identifiers remain legitimate and owned', () => {
  const evaluator=new GeofenceEvaluator(); evaluator.registerGeofence(fence({id:0}));
  const event=evaluator.evaluateLocation(0,20,70)[0];
  assert.equal(event.tripId,0); assert.equal(event.geofenceId,0);
  evaluator.clearTrip(0); assert.equal(evaluator.tripStates.size,0);
});

test('actual routing profitability consumer keeps antipodal distances and financial output finite', () => {
  const origin={lat:-78.69141861796379,lng:139.72028566058725};
  const destination={lat:-origin.lat,lng:origin.lng-180};
  const actual=new ProfitabilityScorer().scoreAndRankMatches({origin,destination},[{id:'private-load',pickup_lat:origin.lat,pickup_lng:origin.lng,drop_lat:destination.lat,drop_lng:destination.lng,price_paisa:500000}]);
  assert.equal(actual.length,1);
  assert.ok(Object.values(actual[0].detourMetrics).every(Number.isFinite));
  assert.ok(Object.values(actual[0].financials).every(Number.isFinite));
  assert.equal(actual[0].detourMetrics.incrementalDetourKm,0);
  assert.equal(actual[0].affinityScore,1);
});
