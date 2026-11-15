
import { RoaringBitmapIndexer } from './roaring_bitmap.js';
import assert from 'node:assert/strict';

console.log('Testing Roaring Bitmap Fleet Indexer...\n');

const indexer = new RoaringBitmapIndexer();

// Helper function for testing
function testCase(description, actual, expected) {
    assert.deepStrictEqual(actual, expected, description);
    console.log(`✅ ${description}`);
}

// 1. Add driver attributes
indexer.setDriverBit('ACTIVE', 10);
indexer.setDriverBit('ACTIVE', 12);
indexer.setDriverBit('ACTIVE', 15);

indexer.setDriverBit('HAZMAT', 12);
indexer.setDriverBit('HAZMAT', 15);

indexer.setDriverBit('REFRIGERATED', 15);

indexer.setDriverBit('LONG_DISTANCE', 10);
indexer.setDriverBit('LONG_DISTANCE', 15);

// 2. Test Active drivers
testCase(
    'Active drivers',
    indexer.intersectAttributes(['ACTIVE']),
    [10, 12, 15]
);

// 3. Test Active and Hazmat drivers
testCase(
    'Active and Hazmat drivers',
    indexer.intersectAttributes(['ACTIVE', 'HAZMAT']),
    [12, 15]
);

// 4. Test three attribute intersection
testCase(
    'Active, Hazmat and Refrigerated drivers',
    indexer.intersectAttributes([
        'ACTIVE',
        'HAZMAT',
        'REFRIGERATED'
    ]),
    [15]
);

// 5. Test multiple matching attributes
testCase(
    'Active and Long Distance drivers',
    indexer.intersectAttributes([
        'ACTIVE',
        'LONG_DISTANCE'
    ]),
    [10, 15]
);

// 6. Test non-existent attribute
testCase(
    'Non-existent attribute',
    indexer.intersectAttributes(['NON_EXISTENT']),
    []
);

// 7. Test no matching drivers
testCase(
    'No matching drivers',
    indexer.intersectAttributes([
        'ACTIVE',
        'HAZMAT',
        'REFRIGERATED',
        'NON_EXISTENT'
    ]),
    []
);

// 8. Test duplicate driver insertion
indexer.setDriverBit('ACTIVE', 10);
indexer.setDriverBit('HAZMAT', 12);

testCase(
    'Duplicate insertion does not duplicate driver IDs',
    indexer.intersectAttributes(['ACTIVE']),
    [10, 12, 15]
);

// 9. Test repeated queries
testCase(
    'Repeated intersection query',
    indexer.intersectAttributes(['ACTIVE', 'HAZMAT']),
    [12, 15]
);

testCase(
    'Original index data remains unchanged',
    indexer.intersectAttributes(['ACTIVE']),
    [10, 12, 15]
);

console.log('\n🎉 All Roaring Bitmap Fleet Indexer tests passed!');
