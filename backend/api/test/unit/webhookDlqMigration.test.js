import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = '20260807000000_make_webhook_dlq_crash_safe.sql';
const readMigration = () =>
  readFileSync(path.resolve(__dirname, `../../../../supabase/migrations/${MIGRATION}`), 'utf8');

describe(`Migration ${MIGRATION} — crash-safe webhook DLQ`, () => {
  const content = readMigration();

  it('adds processing to the status CHECK constraint', () => {
    expect(content).toMatch(/CHECK \(status IN \('pending', 'processing', 'failed_permanently', 'resolved'\)\)/);
  });

  it('does not rewrite the table (preserves existing rows)', () => {
    expect(content).toMatch(/ALTER TABLE webhook_failures/);
    expect(content).not.toMatch(/DROP TABLE/);
    expect(content).not.toMatch(/ALTER TABLE webhook_failures\s+RENAME TO/);
  });

  it('adds lease/ownership, idempotency and completion columns', () => {
    expect(content).toMatch(/claimed_by text/);
    expect(content).toMatch(/claimed_at timestamptz/);
    expect(content).toMatch(/lease_expires_at timestamptz/);
    expect(content).toMatch(/resolved_at timestamptz/);
    expect(content).toMatch(/dedupe_key text/);
    expect(content).toMatch(/attempt_count integer NOT NULL DEFAULT 0/);
  });

  it('adds a unique partial index for dedupe_key', () => {
    expect(content).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_failures_dedupe_key/);
    expect(content).toMatch(/WHERE dedupe_key IS NOT NULL/);
  });

  it('adds a polling index for expired-lease reclaims', () => {
    expect(content).toMatch(/CREATE INDEX IF NOT EXISTS idx_webhook_failures_processing_lease/);
    expect(content).toMatch(/WHERE status = 'processing'/);
  });

  it('defines claim_webhook_failure_batch as a service_role-only SECURITY DEFINER RPC', () => {
    expect(content).toMatch(/CREATE OR REPLACE FUNCTION claim_webhook_failure_batch/);
    expect(content).toMatch(/SECURITY DEFINER/);
    expect(content).toMatch(/auth\.role\(\) <> 'service_role'/);
    expect(content).toMatch(/GRANT EXECUTE ON FUNCTION claim_webhook_failure_batch\([^)]*\) TO service_role/);
  });

  it('uses SELECT ... FOR UPDATE SKIP LOCKED for atomic multi-replica claiming', () => {
    expect(content).toMatch(/FOR UPDATE SKIP LOCKED/);
  });

  it('reclaims expired-lease processing rows and escalates crash-loops', () => {
    // pending-due rows are eligible…
    expect(content).toMatch(/status = 'pending' AND next_retry_at <= v_now/);
    // …expired processing leases are reclaimable…
    expect(content).toMatch(/status = 'processing' AND lease_expires_at < v_now/);
    // …and a crash-loop guard escalates stale claims.
    expect(content).toMatch(/attempt_count >= p_max_attempts/);
  });
});
