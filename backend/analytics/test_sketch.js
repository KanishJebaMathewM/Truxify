import { CountMinSketch } from './count_min_sketch.js';
import assert from 'assert';

console.log('Testing Count-Min Sketch Engine...');

const sketch = new CountMinSketch(500, 4);
const routeA = 'ROUTE_DELHI_MUMBAI';
const routeB = 'ROUTE_CHENNAI_BANGALORE';

for (let i = 0; i < 150; i++) sketch.add(routeA);
for (let i = 0; i < 45; i++) sketch.add(routeB);

const estA = sketch.estimate(routeA);
const estB = sketch.estimate(routeB);

assert.strictEqual(estA >= 150, true);
assert.strictEqual(estB >= 45, true);

console.log(`Estimated ${routeA}: ${estA} (Actual: 150)`);
console.log(`Estimated ${routeB}: ${estB} (Actual: 45)`);
console.log('✅ Count-Min Sketch tests passed successfully.');
