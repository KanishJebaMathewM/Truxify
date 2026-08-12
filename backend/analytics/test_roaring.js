import { RoaringBitmapIndexer } from './roaring_bitmap.js';
import assert from 'assert';

console.log('Testing Roaring Bitmap Fleet Indexer...');

const indexer = new RoaringBitmapIndexer();

// Driver indices matching criteria: Active, Hazmat, Refrigerated
indexer.setDriverBit('ACTIVE', 10);
indexer.setDriverBit('ACTIVE', 12);
indexer.setDriverBit('ACTIVE', 15);

indexer.setDriverBit('HAZMAT', 12);
indexer.setDriverBit('HAZMAT', 15);

indexer.setDriverBit('REFRIGERATED', 15);

const activeHazmat = indexer.intersectAttributes(['ACTIVE', 'HAZMAT']);
assert.deepStrictEqual(activeHazmat, [12, 15]);

const activeHazmatRef = indexer.intersectAttributes(['ACTIVE', 'HAZMAT', 'REFRIGERATED']);
assert.deepStrictEqual(activeHazmatRef, [15]);

console.log('✅ Roaring Bitmap bitwise tests passed successfully.');
