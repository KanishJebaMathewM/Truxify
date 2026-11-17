
import { CountMinSketch } from "./count_min_sketch.js";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

console.log("Testing Count-Min Sketch Engine...\n");

const startTime = performance.now();

try {
    // Initialize Count-Min Sketch
    const sketch = new CountMinSketch(500, 4);

    assert.ok(sketch, "Sketch initialization failed");

    // Test routes
    const routeA = "ROUTE_DELHI_MUMBAI";
    const routeB = "ROUTE_CHENNAI_BANGALORE";
    const routeC = "ROUTE_MUMBAI_PUNE";

    const testCases = [
        { route: routeA, count: 150 },
        { route: routeB, count: 45 },
        { route: routeC, count: 75 },
    ];

    // Insert route frequencies
    for (const { route, count } of testCases) {
        for (let i = 0; i < count; i++) {
            sketch.add(route);
        }
    }

    console.log("Checking frequency estimates...\n");

    // Verify estimates
    for (const { route, count } of testCases) {
        const estimate = sketch.estimate(route);

        assert.ok(
            Number.isFinite(estimate) && estimate >= 0,
            `Invalid estimate for ${route}: ${estimate}`
        );

        assert.ok(
            estimate >= count,
            `Estimate ${estimate} is below actual count ${count} for ${route}`
        );

        console.log(
            `${route}: Estimated ${estimate} | Actual ${count}`
        );
    }

    // Test repeated queries
    const repeatedEstimate = sketch.estimate(routeA);

    assert.equal(
        repeatedEstimate,
        sketch.estimate(routeA),
        "Repeated estimates should be consistent"
    );

    // Test unknown route
    const unknownRoute = sketch.estimate("UNKNOWN_ROUTE");

    assert.ok(
        Number.isFinite(unknownRoute) && unknownRoute >= 0,
        "Unknown route returned an invalid estimate"
    );

    console.log(`\nUnknown route estimate: ${unknownRoute}`);

    const endTime = performance.now();

    console.log("\nAll Count-Min Sketch tests passed!");
    console.log(
        `Execution time: ${(endTime - startTime).toFixed(2)} ms`
    );

} catch (error) {
    console.error("\nCount-Min Sketch tests failed!");
    console.error(error.message);
    process.exitCode = 1;
}
