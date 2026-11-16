import assert from 'assert';
import {
  calculateTripTireDegradation,
  calculateTireWear,
  TIRE_LIFESPAN_KM,
  INITIAL_TREAD_DEPTH_MM,
  LEGAL_MIN_TREAD_STEER_MM,
  LEGAL_MIN_TREAD_OTHER_MM,
  AXLE_WEAR_MULTIPLIERS,
  ROAD_CONDITION_FACTORS,
  WEATHER_FACTORS,
} from '../../src/services/tireWearService.js';

console.log('--- Running Tire Wear Prognostics & Axle Load Degradation Tests ---');

let testsPassed = 0;
async function test(name, fn) {
  try {
    await fn();
    testsPassed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message);
    throw err;
  }
}

// 1. Constants & Threshold Boundaries
await test('defines realistic commercial fleet lifespan parameters', () => {
  assert.strictEqual(TIRE_LIFESPAN_KM, 80000);
  assert.strictEqual(INITIAL_TREAD_DEPTH_MM, 16.0);
  assert.strictEqual(LEGAL_MIN_TREAD_STEER_MM, 3.175);
  assert.strictEqual(LEGAL_MIN_TREAD_OTHER_MM, 1.5875);
});

await test('defines distinct axle wear multipliers reflecting physics', () => {
  assert.ok(AXLE_WEAR_MULTIPLIERS.steer > AXLE_WEAR_MULTIPLIERS.drive);
  assert.ok(AXLE_WEAR_MULTIPLIERS.drive > AXLE_WEAR_MULTIPLIERS.trailer);
  assert.strictEqual(AXLE_WEAR_MULTIPLIERS.steer, 1.25);
});

await test('defines weather and road surface environmental factors', () => {
  assert.ok(ROAD_CONDITION_FACTORS.unpaved > ROAD_CONDITION_FACTORS.good);
  assert.ok(WEATHER_FACTORS.extreme_heat > WEATHER_FACTORS.clear);
  assert.ok(WEATHER_FACTORS.snow > WEATHER_FACTORS.clear);
});

// 2. calculateTripTireDegradation
await test('calculates baseline wear on ideal highway conditions for steer axle', () => {
  const result = calculateTripTireDegradation({
    distanceKm: 1000,
    loadWeightKg: 0,
    roadCondition: 'good',
    weather: 'clear',
    axleType: 'steer',
    currentTreadDepthMm: 16.0,
  });

  assert.strictEqual(result.distanceKm, 1000);
  assert.strictEqual(result.effectiveDistanceKm, 1250); // 1000 * 1.25 (steer)
  assert.ok(result.endingTreadDepthMm < 16.0);
  assert.ok(result.treadLossMm > 0);
  assert.strictEqual(result.isBelowLegalLimit, false);
  assert.strictEqual(result.requiresReplacement, false);
  assert.ok(result.blowoutHazardProbability < 0.05);
});

await test('applies higher degradation for drive axle under heavy cargo payload', () => {
  const emptyResult = calculateTripTireDegradation({
    distanceKm: 500,
    loadWeightKg: 0,
    axleType: 'drive',
  });

  const loadedResult = calculateTripTireDegradation({
    distanceKm: 500,
    loadWeightKg: 25000,
    axleType: 'drive',
  });

  assert.ok(loadedResult.effectiveDistanceKm > emptyResult.effectiveDistanceKm);
  assert.ok(loadedResult.treadLossMm > emptyResult.treadLossMm);
});

await test('amplifies wear during extreme heat and gravel roads', () => {
  const baseline = calculateTripTireDegradation({
    distanceKm: 400,
    roadCondition: 'good',
    weather: 'clear',
  });

  const harsh = calculateTripTireDegradation({
    distanceKm: 400,
    roadCondition: 'gravel',
    weather: 'extreme_heat',
  });

  assert.ok(harsh.effectiveDistanceKm > baseline.effectiveDistanceKm * 2.0);
});

await test('flags legal minimum tread breaches on worn steer tires', () => {
  const result = calculateTripTireDegradation({
    distanceKm: 5000,
    axleType: 'steer',
    currentTreadDepthMm: 3.5,
  });

  assert.strictEqual(result.isBelowLegalLimit, true);
  assert.strictEqual(result.requiresReplacement, true);
  assert.ok(result.blowoutHazardProbability > 0.2);
});

await test('throws RangeError when distanceKm is negative or non-finite', () => {
  assert.throws(() => calculateTripTireDegradation({ distanceKm: -10 }), RangeError);
  assert.throws(() => calculateTripTireDegradation({ distanceKm: NaN }), RangeError);
});

await test('throws RangeError when loadWeightKg is negative or non-finite', () => {
  assert.throws(() => calculateTripTireDegradation({ distanceKm: 100, loadWeightKg: -500 }), RangeError);
  assert.throws(() => calculateTripTireDegradation({ distanceKm: 100, loadWeightKg: Infinity }), RangeError);
});

// 3. calculateTireWear (Aggregate Fleet Prognostics)
await test('returns safe baseline defaults when driver has no operational trips', async () => {
  const result = await calculateTireWear('driver-test-01', []);

  assert.strictEqual(result.hasData, false);
  assert.strictEqual(result.wearPercentage, 0);
  assert.strictEqual(result.remainingKm, TIRE_LIFESPAN_KM);
  assert.strictEqual(result.currentTreadDepthMm, INITIAL_TREAD_DEPTH_MM);
  assert.strictEqual(result.needsReplacement, false);
  assert.strictEqual(result.rotationRecommended, false);
});

await test('throws TypeError when driverId is invalid', async () => {
  await assert.rejects(async () => calculateTireWear(''), TypeError);
  await assert.rejects(async () => calculateTireWear(null), TypeError);
});

await test('aggregates multi-axle trip telemetry accurately', async () => {
  const trips = [
    { distance_km: 10000, load_weight_kg: 15000, road_condition: 'good', weather: 'clear', axle_type: 'steer' },
    { distance_km: 10000, load_weight_kg: 15000, road_condition: 'average', weather: 'rain', axle_type: 'drive' },
    { distance_km: 10000, load_weight_kg: 15000, road_condition: 'good', weather: 'clear', axle_type: 'trailer' },
  ];

  const result = await calculateTireWear('driver-test-02', trips);

  assert.strictEqual(result.hasData, true);
  assert.strictEqual(result.totalTripsAnalyzed, 3);
  assert.ok(result.wearPercentage > 0);
  assert.ok(result.remainingKm < TIRE_LIFESPAN_KM);
  assert.ok(result.currentTreadDepthMm < INITIAL_TREAD_DEPTH_MM);
  assert.ok(result.axleDistributionKm.steer > 0);
  assert.ok(result.axleDistributionKm.drive > 0);
  assert.ok(result.axleDistributionKm.trailer > 0);
});

await test('triggers rotation recommendation when axle wear differential is significant', async () => {
  // 35,000 km exclusively on steer axle induces severe differential
  const trips = [
    { distance_km: 15000, load_weight_kg: 0, road_condition: 'good', weather: 'clear', axle_type: 'steer' },
    { distance_km: 3000, load_weight_kg: 0, road_condition: 'good', weather: 'clear', axle_type: 'drive' },
    { distance_km: 3000, load_weight_kg: 0, road_condition: 'good', weather: 'clear', axle_type: 'trailer' },
  ];

  const result = await calculateTireWear('driver-test-03', trips);

  assert.strictEqual(result.rotationRecommended, true);
  assert.ok(result.message.includes('Tire rotation recommended'));
});

await test('triggers critical replacement warning when cumulative wear exceeds safety limits', async () => {
  const heavyTrips = [
    { distance_km: 35000, load_weight_kg: 22000, road_condition: 'poor', weather: 'extreme_heat', axle_type: 'steer' },
    { distance_km: 35000, load_weight_kg: 22000, road_condition: 'poor', weather: 'extreme_heat', axle_type: 'drive' },
  ];

  const result = await calculateTireWear('driver-test-04', heavyTrips);

  assert.ok(result.wearPercentage >= 80);
  assert.strictEqual(result.needsReplacement, true);
  assert.ok(result.blowoutHazardScore > 0.5);
  assert.ok(result.message.includes('CRITICAL ALERT'));
});

console.log(`\n🎉 All ${testsPassed} Tire Wear Prognostics unit tests passed successfully!\n`);
