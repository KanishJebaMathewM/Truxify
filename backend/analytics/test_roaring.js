
import { RoaringBitmapIndexer } from './roaring_bitmap.js';
import assert from 'node:assert/strict';

console.log('Testing Roaring Bitmap Fleet Indexer...');

const indexer = new RoaringBitmapIndexer();

// Add driver attributes
indexer.setDriverBit('ACTIVE', 10);
indexer.setDriverBit('ACTIVE', 12);
indexer.setDriverBit('ACTIVE', 15);

indexer.setDriverBit('HAZMAT', 12);
indexer.setDriverBit('HAZMAT', 15);

indexer.setDriverBit('REFRIGERATED', 15);

// Test Active and Hazmat drivers
const activeHazmat = indexer.intersectAttributes([
  'ACTIVE',
  'HAZMAT'
]);

assert.deepStrictEqual(activeHazmat, [12, 15]);

// Test Active, Hazmat and Refrigerated drivers
const activeHazmatRef = indexer.intersectAttributes([
  'ACTIVE',
  'HAZMAT',
  'REFRIGERATED'
]);

assert.deepStrictEqual(activeHazmatRef, [15]);

// Test Active drivers only
const activeDrivers = indexer.intersectAttributes(['ACTIVE']);

assert.deepStrictEqual(activeDrivers, [10, 12, 15]);

// Test no matching drivers
const noMatch = indexer.intersectAttributes([
  'HAZMAT',
  'REFRIGERATED',
  'ACTIVE',
  'NON_EXISTENT'
]);

assert.deepStrictEqual(noMatch, []);

console.log('✅ All Roaring Bitmap Fleet Indexer tests passed!');
