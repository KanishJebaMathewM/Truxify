import assert from 'node:assert';
import {
    calculateHaversineDistanceMatrix,
    getDistanceMatrixWithResilience,
    calculateStraightLineDistance,
    estimateDurationFromDistance,
    setAxiosClientForTesting,
    resetAxiosClient
} from '../../src/services/osrmService.js';
import { getRoute, getDistanceMatrix } from '../../src/controllers/routingController.js';

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}:`, err.message);
        throw err;
    }
}

console.log('--- Running Telematics Routing & Haversine Distance Matrix Tests ---');

// Indian logistics hub waypoints (lon, lat)
const BANGALORE = [77.5946, 12.9716];
const CHENNAI = [80.2707, 13.0827];
const HYDERABAD = [78.4867, 17.3850];
const MUMBAI = [72.8777, 19.0760];

await test('computes 2x2 distance matrix with zero diagonals and symmetry', async () => {
    const coords = [BANGALORE, CHENNAI];
    const matrix = calculateHaversineDistanceMatrix(coords, { tortuosityFactor: 1.0 });

    assert.strictEqual(matrix.distances.length, 2);
    assert.strictEqual(matrix.distances[0].length, 2);
    assert.strictEqual(matrix.distances[0][0], 0);
    assert.strictEqual(matrix.distances[1][1], 0);
    assert.strictEqual(matrix.durations[0][0], 0);
    assert.strictEqual(matrix.durations[1][1], 0);

    // Symmetry check: D[0][1] === D[1][0]
    assert.strictEqual(matrix.distances[0][1], matrix.distances[1][0]);
    assert.strictEqual(matrix.durations[0][1], matrix.durations[1][0]);

    // Bangalore to Chennai straight line is ~290 km (290,000 m)
    assert.ok(matrix.distances[0][1] > 280000 && matrix.distances[0][1] < 300000);
});

await test('applies freight tortuosity factor correctly to account for road curvature', async () => {
    const coords = [BANGALORE, HYDERABAD];
    const straightLine = calculateHaversineDistanceMatrix(coords, { tortuosityFactor: 1.0 });
    const roadNetwork = calculateHaversineDistanceMatrix(coords, { tortuosityFactor: 1.25 });

    const rawMeters = straightLine.distances[0][1];
    const scaledMeters = roadNetwork.distances[0][1];

    assert.strictEqual(scaledMeters, Math.round(rawMeters * 1.25));
    assert.strictEqual(roadNetwork.tortuosityFactor, 1.25);
});

await test('computes 4x4 distance matrix and verifies triangle inequality', async () => {
    const coords = [BANGALORE, CHENNAI, HYDERABAD, MUMBAI];
    const matrix = calculateHaversineDistanceMatrix(coords, { tortuosityFactor: 1.2 });

    assert.strictEqual(matrix.distances.length, 4);
    for (let i = 0; i < 4; i++) {
        assert.strictEqual(matrix.distances[i][i], 0);
        for (let j = 0; j < 4; j++) {
            assert.strictEqual(matrix.distances[i][j], matrix.distances[j][i]);
        }
    }

    // Triangle inequality: D(Bangalore, Mumbai) <= D(Bangalore, Hyderabad) + D(Hyderabad, Mumbai)
    const dBM = matrix.distances[0][3];
    const dBH = matrix.distances[0][2];
    const dHM = matrix.distances[2][3];

    assert.ok(dBM <= dBH + dHM, `Triangle inequality failed: ${dBM} > ${dBH} + ${dHM}`);
});

await test('scales truck duration by average corridor speed', async () => {
    const coords = [BANGALORE, CHENNAI];
    const slowTruck = calculateHaversineDistanceMatrix(coords, { averageSpeedKmh: 30 });
    const fastTruck = calculateHaversineDistanceMatrix(coords, { averageSpeedKmh: 60 });

    const durationSlow = slowTruck.durations[0][1];
    const durationFast = fastTruck.durations[0][1];

    // Fast truck should take approximately half the time of slow truck
    const ratio = durationSlow / durationFast;
    assert.ok(ratio > 1.95 && ratio < 2.05, `Speed ratio deviation: ${ratio}`);
});

await test('rejects invalid, missing, or malformed coordinate waypoints', () => {
    assert.throws(() => calculateHaversineDistanceMatrix([]), /at least 2 coordinate pairs/);
    assert.throws(() => calculateHaversineDistanceMatrix([BANGALORE]), /at least 2 coordinate pairs/);
    assert.throws(() => calculateHaversineDistanceMatrix([BANGALORE, 'not-an-array']), /must be an array/);
    assert.throws(() => calculateHaversineDistanceMatrix([BANGALORE, [999, 12.0]]), /Longitude must be between/);
    assert.throws(() => calculateHaversineDistanceMatrix([BANGALORE, [77.0, -95.0]]), /Latitude must be between/);
});

await test('enforces maximum matrix size limit to prevent memory exhaustion', () => {
    const coords = Array.from({ length: 60 }, (_, i) => [77.0 + i * 0.01, 12.0 + i * 0.01]);
    assert.throws(() => calculateHaversineDistanceMatrix(coords, { maxPoints: 50 }), /Exceeded maximum allowed matrix points/);
});

await test('falls back gracefully to Haversine matrix when OSRM times out', async () => {
    const mockAxios = {
        get: async () => {
            throw new Error('connect ECONNREFUSED 127.0.0.1:5000');
        }
    };
    setAxiosClientForTesting(mockAxios);

    try {
        const coords = [BANGALORE, CHENNAI, HYDERABAD];
        const res = await getDistanceMatrixWithResilience(coords, { tortuosityFactor: 1.25 });

        assert.strictEqual(res.fallback, true);
        assert.ok(res.message.includes('OSRM distance matrix degraded'));
        assert.strictEqual(res.distances.length, 3);
        assert.strictEqual(res.durations.length, 3);
        assert.ok(res.distances[0][1] > 0);
    } finally {
        resetAxiosClient();
    }
});

await test('routingController.getRoute validates coordinates and query strings', async () => {
    let statusCode = null;
    let jsonBody = null;

    const res = {
        status: (code) => {
            statusCode = code;
            return {
                json: (body) => {
                    jsonBody = body;
                    return body;
                }
            };
        }
    };

    // Missing query parameters
    await getRoute({ query: { startLon: '77.59' } }, res);
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonBody.error, 'Missing coordinates');

    // Invalid non-finite parameter
    await getRoute({ query: { startLon: 'abc', startLat: '12.9', endLon: '80.2', endLat: '13.0' } }, res);
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonBody.error, 'Invalid coordinates');

    // Out of bounds coordinate
    await getRoute({ query: { startLon: '77.59', startLat: '95.0', endLon: '80.2', endLat: '13.0' } }, res);
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonBody.error, 'Out of range latitude');
});

await test('routingController.getRoute computes route with metric unit conversions', async () => {
    let statusCode = null;
    let jsonBody = null;

    const res = {
        status: (code) => {
            statusCode = code;
            return {
                json: (body) => {
                    jsonBody = body;
                    return body;
                }
            };
        }
    };

    await getRoute({
        query: {
            startLon: '77.5946',
            startLat: '12.9716',
            endLon: '80.2707',
            endLat: '13.0827',
            units: 'km'
        }
    }, res);

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonBody.success, true);
    assert.strictEqual(jsonBody.data.units.distance, 'kilometers');
    assert.strictEqual(jsonBody.data.units.duration, 'minutes');
    assert.ok(jsonBody.data.distance > 200 && jsonBody.data.distance < 400);
});

await test('routingController.getDistanceMatrix processes multi-stop matrix with metric scaling', async () => {
    let statusCode = null;
    let jsonBody = null;

    const res = {
        status: (code) => {
            statusCode = code;
            return {
                json: (body) => {
                    jsonBody = body;
                    return body;
                }
            };
        }
    };

    await getDistanceMatrix({
        body: {
            coordinates: [BANGALORE, CHENNAI, HYDERABAD],
            tortuosityFactor: 1.25,
            units: 'km'
        }
    }, res);

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonBody.success, true);
    assert.strictEqual(jsonBody.matrixSize, 3);
    assert.strictEqual(jsonBody.units.distance, 'kilometers');
    assert.strictEqual(jsonBody.units.duration, 'minutes');
    assert.strictEqual(jsonBody.data.distances.length, 3);
    assert.strictEqual(jsonBody.data.distances[0][0], 0);
});

await test('routingController.getDistanceMatrix rejects malformed body structures', async () => {
    let statusCode = null;
    let jsonBody = null;

    const res = {
        status: (code) => {
            statusCode = code;
            return {
                json: (body) => {
                    jsonBody = body;
                    return body;
                }
            };
        }
    };

    // Less than 2 coordinates
    await getDistanceMatrix({ body: { coordinates: [BANGALORE] } }, res);
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonBody.error, 'Invalid coordinates');

    // Waypoint with out of bounds latitude
    await getDistanceMatrix({ body: { coordinates: [BANGALORE, [80.0, 95.0]] } }, res);
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonBody.error, 'Latitude out of bounds');

    // Matrix size exceeding limit
    const coords = Array.from({ length: 15 }, () => BANGALORE);
    await getDistanceMatrix({ body: { coordinates: coords, maxPoints: 10 } }, res);
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonBody.error, 'Matrix size limit exceeded');
});

console.log('\n🎉 All Telematics Routing & Haversine Distance Matrix tests passed successfully!\n');
