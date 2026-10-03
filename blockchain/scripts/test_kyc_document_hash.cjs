const assert = require('assert');
const { hashDocument, stringToBytes } = require('./generate-zk-proof.cjs');

const baseDocument = {
    name: 'Rajesh Kumar',
    licenseNumber: 'DL-2024-123456',
    rcNumber: 'RC-2024-789012',
    insuranceNumber: 'INS-2024-345678'
};

const expectedHash = '18177082530528546893785912510510193780391998371811254825352012934849146262553';

assert.strictEqual(
    hashDocument(baseDocument),
    expectedHash,
    'document hash must match the KYC circuit field-level Poseidon construction'
);

const unchanged = {
    ...baseDocument,
    issueDate: '1900-01-01',
    expiryDate: '2099-12-31'
};
assert.strictEqual(
    hashDocument(unchanged),
    expectedHash,
    'fields not represented by the circuit must not affect the public document hash'
);

const mutated = { ...baseDocument, name: 'Rajesh Kuman' };
assert.notStrictEqual(
    hashDocument(mutated),
    expectedHash,
    'changing a hashed document field must change the document hash'
);

const unicodeBytes = stringToBytes('नाम', 100);
assert.strictEqual(unicodeBytes.length, 100);
assert.strictEqual(Buffer.from(unicodeBytes.slice(0, 9)).toString('utf8'), 'नाम');
assert.ok(unicodeBytes.slice(9).every((value) => value === 0));

assert.throws(
    () => stringToBytes('x'.repeat(101), 100),
    RangeError,
    'oversized KYC fields must be rejected'
);

assert.throws(
    () => stringToBytes(123, 100),
    TypeError,
    'non-string KYC fields must be rejected'
);

console.log('✅ KYC document hash consistency tests passed.');
