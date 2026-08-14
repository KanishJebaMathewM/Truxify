import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Testing ZKID Database Migration and Service Mapping...');

const migrationPath = path.resolve(__dirname, '../../supabase/migrations/20260808100000_create_zkid_tables.sql');
assert.strictEqual(fs.existsSync(migrationPath), true, 'Migration file 20260808100000_create_zkid_tables.sql must exist');

const sql = fs.readFileSync(migrationPath, 'utf8');

// 1. Verify tables creation
const requiredTables = [
    'zkid_identities',
    'zkid_credentials',
    'zkid_verifications',
    'zkid_disclosures'
];

for (const table of requiredTables) {
    assert.strictEqual(
        sql.includes(`create table if not exists ${table}`),
        true,
        `Migration must create table '${table}'`
    );
    assert.strictEqual(
        sql.includes(`alter table ${table} enable row level security;`),
        true,
        `Migration must enable RLS on '${table}'`
    );
    assert.strictEqual(
        sql.includes(`Service role full access on ${table}`),
        true,
        `Migration must set service_role policy on '${table}'`
    );
}

// 2. Verify all service columns in zkid_identities
const identityColumns = ['identity_hash', 'user_address', 'tx_hash', 'is_active', 'created_at'];
for (const col of identityColumns) {
    assert.strictEqual(sql.includes(col), true, `zkid_identities must contain column '${col}'`);
}

// 3. Verify all service columns in zkid_credentials
const credentialColumns = ['credential_hash', 'identity_hash', 'credential_type', 'tx_hash', 'revoked', 'issued_at', 'revoked_at'];
for (const col of credentialColumns) {
    assert.strictEqual(sql.includes(col), true, `zkid_credentials must contain column '${col}'`);
}

// 4. Verify all service columns in zkid_verifications
const verificationColumns = ['request_id', 'identity_hash', 'credential_hash', 'tx_hash', 'verified', 'created_at'];
for (const col of verificationColumns) {
    assert.strictEqual(sql.includes(col), true, `zkid_verifications must contain column '${col}'`);
}

// 5. Verify all service columns in zkid_disclosures
const disclosureColumns = ['disclosure_id', 'identity_hash', 'disclosed_attributes', 'recipient', 'tx_hash', 'created_at'];
for (const col of disclosureColumns) {
    assert.strictEqual(sql.includes(col), true, `zkid_disclosures must contain column '${col}'`);
}

// 6. Verify JSONB type for disclosed_attributes
assert.strictEqual(sql.includes('disclosed_attributes jsonb'), true, 'disclosed_attributes must be of type jsonb');

console.log('✅ ZKID Database Migration tests passed successfully.');
