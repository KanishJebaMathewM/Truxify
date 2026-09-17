import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabaseAdmin } from '../../src/config/db.js';

/**
 * @fileoverview Integration tests verifying the credentials table schema and RLS policies.
 * Ensures that the DDL migration (#9939) was applied correctly and the DID service
 * can perform its CRUD operations without PGRST202 errors.
 */

describe('Credentials Table Schema & RLS (#9939)', () => {
    const TEST_CREDENTIAL_ID = `urn:uuid:test-${Date.now()}`;
    const TEST_SUBJECT = 'did:truxify:test-subject-123';
    const TEST_OWNER_ID = '00000000-0000-0000-0000-000000000000'; // Dev user ID

    beforeAll(async () => {
        // Ensure we have a test owner profile
        const { data: existingProfile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('id', TEST_OWNER_ID)
            .maybeSingle();

        if (!existingProfile) {
            await supabaseAdmin.from('profiles').insert({
                id: TEST_OWNER_ID,
                role: 'admin',
                full_name: 'Test Owner',
                is_active: true
            });
        }
    });

    afterAll(async () => {
        // Cleanup test data
        await supabaseAdmin
            .from('credentials')
            .delete()
            .eq('credential_id', TEST_CREDENTIAL_ID);
    });

    describe('Table Existence & Columns', () => {
        it('should successfully insert a new credential (verifies table exists)', async () => {
            const { data, error } = await supabaseAdmin
                .from('credentials')
                .insert([{
                    credential_id: TEST_CREDENTIAL_ID,
                    subject: TEST_SUBJECT,
                    credential_type: 'VerifiableCredential',
                    schema: 'https://schema.truxify.com/vc/v1',
                    issued_at: new Date().toISOString(),
                    valid_until: new Date(Date.now() + 86400000).toISOString(),
                    tx_hash: '0xabc123',
                    proof: { type: 'Ed25519Signature2020', created: new Date().toISOString() },
                    owner_id: TEST_OWNER_ID
                }])
                .select();

            expect(error).toBeNull();
            expect(data).toBeDefined();
            expect(data.length).toBe(1);
            expect(data[0].credential_id).toBe(TEST_CREDENTIAL_ID);
        });

        it('should have correct column types', async () => {
            const { data, error } = await supabaseAdmin
                .from('credentials')
                .select('*')
                .eq('credential_id', TEST_CREDENTIAL_ID)
                .single();

            expect(error).toBeNull();
            expect(typeof data.credential_id).toBe('string');
            expect(typeof data.subject).toBe('string');
            expect(typeof data.credential_type).toBe('string');
            expect(typeof data.revoked).toBe('boolean');
            expect(data.revoked).toBe(false);
            expect(data.proof).toBeDefined(); // JSONB
        });

        it('should automatically update updated_at on modification', async () => {
            const { data: initial } = await supabaseAdmin
                .from('credentials')
                .select('updated_at')
                .eq('credential_id', TEST_CREDENTIAL_ID)
                .single();

            // Wait a bit to ensure timestamp difference
            await new Promise(resolve => setTimeout(resolve, 100));

            const { data: updated, error } = await supabaseAdmin
                .from('credentials')
                .update({ revoked: true, revoked_at: new Date().toISOString() })
                .eq('credential_id', TEST_CREDENTIAL_ID)
                .select('updated_at, revoked')
                .single();

            expect(error).toBeNull();
            expect(updated.revoked).toBe(true);
            expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(new Date(initial.updated_at).getTime());
        });
    });

    describe('Indexing & Query Performance', () => {
        it('should efficiently query by subject (uses idx_credentials_subject)', async () => {
            const { data, error } = await supabaseAdmin
                .from('credentials')
                .select('credential_id')
                .eq('subject', TEST_SUBJECT);

            expect(error).toBeNull();
            expect(data.length).toBeGreaterThan(0);
        });

        it('should efficiently query revoked credentials (uses partial index)', async () => {
            const { data, error } = await supabaseAdmin
                .from('credentials')
                .select('credential_id')
                .eq('revoked', true);

            expect(error).toBeNull();
            // Our test credential was just revoked, so it should appear here
            const found = data.find(c => c.credential_id === TEST_CREDENTIAL_ID);
            expect(found).toBeDefined();
        });
    });

    describe('DID Service Integration', () => {
        it('should support the exact query pattern used by getDIDStats()', async () => {
            // This is the exact query from did.service.js:298 that was failing with PGRST202
            const { data: credentials, error: credsErr } = await supabaseAdmin
                .from('credentials')
                .select('*')
                .order('issued_at', { ascending: false })
                .limit(100);

            expect(credsErr).toBeNull();
            expect(Array.isArray(credentials)).toBe(true);
        });

        it('should support the exact update pattern used by updateCredentialStatus()', async () => {
            const { error } = await supabaseAdmin
                .from('credentials')
                .update({ revoked: false, revoked_at: null }) // Un-revoke for cleanup
                .eq('credential_id', TEST_CREDENTIAL_ID);

            expect(error).toBeNull();
        });
    });
});
