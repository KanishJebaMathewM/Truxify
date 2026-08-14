import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildSummary,
  parseOpenApiRpcFunctions,
  parseRequiredTables,
  verifyIndexes,
} from '../../scripts/verify-db-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('verify-db-schema script helpers', () => {
  it('extracts table names from the schema ER diagram definitions', () => {
    const schema = `
erDiagram
    profiles {
        uuid id PK
    }

    orders {
        uuid id PK
    }

    profiles ||--o{ orders : "customer_id"
`;

    expect(parseRequiredTables(schema)).toEqual(['profiles', 'orders']);
  });

  it('extracts RPC names from PostgREST OpenAPI paths', () => {
    const functions = parseOpenApiRpcFunctions({
      paths: {
        '/profiles': {},
        '/rpc/accept_bid_tx': {},
        '/rpc/withdraw_funds_tx': {},
        '/rpc/submit_rating_tx': {},
      },
    });

    expect(functions).toEqual(new Set(['accept_bid_tx', 'withdraw_funds_tx', 'submit_rating_tx']));
  });

  it('summarizes missing tables and functions', () => {
    const summary = buildSummary(
      [
        { name: 'profiles', ok: true },
        { name: 'orders', ok: false },
      ],
      [
        { name: 'accept_bid_tx', ok: true },
        { name: 'submit_rating_tx', ok: false },
      ]
    );

    expect(summary).toEqual({
      tablesChecked: 2,
      missingTables: 1,
      functionsChecked: 2,
      missingFunctions: 1,
      indexesChecked: 0,
      missingIndexes: 0,
    });
  });

  it('summarizes missing indexes when provided', () => {
    const summary = buildSummary(
      [{ name: 'trips', ok: true }],
      [{ name: 'accept_bid_tx', ok: true }],
      [
        { name: 'idx_trips_driver_status_date', ok: true },
        { name: 'idx_trips_driver_display', ok: false },
      ]
    );

    expect(summary.indexesChecked).toBe(2);
    expect(summary.missingIndexes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Composite index migration tests
// ---------------------------------------------------------------------------

describe('trips composite index migration', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../../supabase/migrations/20260805000000_add_trips_composite_indexes.sql'
  );

  it('migration file exists', async () => {
    await expect(fs.stat(migrationPath)).resolves.toBeDefined();
  });

  it('creates the (driver_id, status, trip_date DESC) composite index', async () => {
    const sql = await fs.readFile(migrationPath, 'utf8');
    expect(sql).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+idx_trips_driver_status_date\s+on\s+trips\s*\(\s*driver_id\s*,\s*status\s*,\s*trip_date\s+desc\s*\)/i
    );
  });

  it('creates the (driver_id, trip_display_id) composite index', async () => {
    const sql = await fs.readFile(migrationPath, 'utf8');
    expect(sql).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+idx_trips_driver_display\s+on\s+trips\s*\(\s*driver_id\s*,\s*trip_display_id\s*\)/i
    );
  });

  it('drops the redundant single-column idx_trips_driver index', async () => {
    const sql = await fs.readFile(migrationPath, 'utf8');
    expect(sql).toMatch(/drop\s+index\s+if\s+exists\s+idx_trips_driver/i);
  });

  it('does NOT drop the remaining single-column indexes', async () => {
    const sql = await fs.readFile(migrationPath, 'utf8');
    // Only idx_trips_driver should be dropped — status and date indexes are
    // still useful for non-driver queries.
    expect(sql).not.toMatch(/drop\s+index\s+if\s+exists\s+idx_trips_status/i);
    expect(sql).not.toMatch(/drop\s+index\s+if\s+exists\s+idx_trips_date/i);
  });

  it('wraps statements in a transaction', async () => {
    const sql = await fs.readFile(migrationPath, 'utf8');
    expect(sql).toMatch(/^\s*begin\s*;/im);
    expect(sql).toMatch(/^\s*commit\s*;/im);
  });

  it('uses IF NOT EXISTS on CREATE INDEX statements (idempotent)', async () => {
    const sql = await fs.readFile(migrationPath, 'utf8');
    const createMatches = [...sql.matchAll(/create\s+index/gi)];
    const idempotentMatches = [...sql.matchAll(/create\s+index\s+if\s+not\s+exists/gi)];
    expect(idempotentMatches.length).toBe(createMatches.length);
  });
});

// ---------------------------------------------------------------------------
// verifyIndexes unit test (offline — mocks fetch)
// ---------------------------------------------------------------------------

describe('verifyIndexes', () => {
  it('marks indexes present when pg_indexes returns matching rows', async () => {
    // Patch global fetch to return a mock pg_indexes response.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => [
        { indexname: 'idx_trips_driver_status_date' },
        { indexname: 'idx_trips_driver_display' },
        { indexname: 'load_offers_status_idx' },
        { indexname: 'profiles_role_idx' },
        { indexname: 'orders_customer_idx' },
        { indexname: 'orders_driver_idx' },
        { indexname: 'trucks_owner_idx' },
      ],
    });

    try {
      const results = await verifyIndexes('https://fake.supabase.co', 'fake-key');
      const missing = results.filter((r) => !r.ok);
      expect(missing).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('marks idx_trips_driver_status_date absent when not returned by pg_indexes', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      // Deliberately omit idx_trips_driver_status_date
      json: async () => [
        { indexname: 'idx_trips_driver_display' },
        { indexname: 'load_offers_status_idx' },
      ],
    });

    try {
      const results = await verifyIndexes('https://fake.supabase.co', 'fake-key');
      const absent = results.find((r) => r.name === 'idx_trips_driver_status_date');
      expect(absent).toBeDefined();
      expect(absent.ok).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('marks all indexes as not-ok when pg_indexes is inaccessible (HTTP 403)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 403 });

    try {
      const results = await verifyIndexes('https://fake.supabase.co', 'anon-key');
      expect(results.every((r) => !r.ok)).toBe(true);
      expect(results[0].message).toMatch(/pg_indexes not accessible/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Existing tests (unchanged)
// ---------------------------------------------------------------------------

describe('Database Schema Constraints and RPC Upsert validation in supabase_setup.sql', () => {
  it('includes durable escrow refund reconciliation fields', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const migrationSqlPath = path.resolve(
      __dirname,
      '../../../../supabase/migrations/20260624233000_track_escrow_refund_reconciliation.sql'
    );

    for (const sqlPath of [setupSqlPath, migrationSqlPath]) {
      const sqlContent = await fs.readFile(sqlPath, 'utf8');
      expect(sqlContent).toMatch(/escrow_refund_error\s+text/i);
      expect(sqlContent).toMatch(/escrow_refund_attempts\s+integer\s+not\s+null\s+default\s+0/i);
      expect(sqlContent).toMatch(/escrow_refund_last_attempt_at\s+timestamptz/i);
      expect(sqlContent).toMatch(/escrow_refund_submitted_at\s+timestamptz/i);
    }
  });

  it('includes the referential integrity migration file', async () => {
    const migrationSqlPath = path.resolve(__dirname, '../../../../docs/migration_add_referential_integrity.sql');
    await expect(fs.stat(migrationSqlPath)).resolves.toBeDefined();
  });

  it('contains the critical foreign key constraints in the migration SQL', async () => {
    const migrationSqlPath = path.resolve(__dirname, '../../../../docs/migration_add_referential_integrity.sql');
    const sqlContent = await fs.readFile(migrationSqlPath, 'utf8');

    expect(sqlContent).toMatch(/driver_details_user_id_fkey[\s\S]*references\s+profiles\s*\(\s*id\s*\)[\s\S]*on delete cascade/i);
    expect(sqlContent).toMatch(/orders_driver_id_fkey[\s\S]*references\s+profiles\s*\(\s*id\s*\)[\s\S]*on delete set null/i);
    expect(sqlContent).toMatch(/load_bids_load_id_fkey[\s\S]*references\s+load_offers\s*\(\s*id\s*\)[\s\S]*on delete cascade/i);
    expect(sqlContent).toMatch(/wallet_transactions_trip_display_id_fkey[\s\S]*references\s+trips\s*\(\s*trip_display_id\s*\)[\s\S]*on delete restrict/i);
    expect(sqlContent).toMatch(/order_timeline_order_display_id_fkey[\s\S]*references\s+orders\s*\(\s*order_display_id\s*\)[\s\S]*on delete cascade/i);
    expect(sqlContent).toMatch(/trip_items_trip_display_id_fkey[\s\S]*references\s+trips\s*\(\s*trip_display_id\s*\)[\s\S]*on delete cascade/i);
    expect(sqlContent).toMatch(/documents_user_id_fkey[\s\S]*references\s+profiles\s*\(\s*id\s*\)[\s\S]*on delete cascade/i);
    expect(sqlContent).toMatch(/driver_details_truck_id_fkey[\s\S]*references\s+trucks\s*\(\s*id\s*\)[\s\S]*on delete set null/i);

    expect(sqlContent).toContain('idx_wallet_txn_order');
    expect(sqlContent).toContain('idx_wallet_txn_trip');
    expect(sqlContent).toContain('idx_maint_tickets_driver');
    expect(sqlContent).toContain('idx_driver_details_truck');
  });

  it('contains the unique constraint on earnings_daily(driver_id, day_date)', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const sqlContent = await fs.readFile(setupSqlPath, 'utf8');
    const hasUniqueConstraint = /constraint\s+earnings_daily_driver_day_unique\s+unique\s*\(\s*driver_id\s*,\s*day_date\s*\)/i.test(sqlContent);
    expect(hasUniqueConstraint).toBe(true);
  });

  it('verifies that complete_trip_tx uses UPSERT behavior with ON CONFLICT', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const sqlContent = await fs.readFile(setupSqlPath, 'utf8');
    const insertMatches = [...sqlContent.matchAll(/insert\s+into\s+earnings_daily[\s\S]*?on\s+conflict\s*\(\s*driver_id\s*,\s*day_date\s*\)\s*do\s+update/gi)];
    expect(insertMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('verifies that complete_trip_tx(p_order_id uuid) finalizes the order-linked trip and raises when none exists', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const migrationSqlPath = path.resolve(__dirname, '../../../../docs/migration_complete_trip_update.sql');

    const setupSql = await fs.readFile(setupSqlPath, 'utf8');
    const migrationSql = await fs.readFile(migrationSqlPath, 'utf8');

    for (const [name, sqlContent] of [['supabase_setup.sql', setupSql], ['migration_complete_trip_update.sql', migrationSql]]) {
      expect(
        /select\s+trip_display_id\s+into\s+v_trip_display_id\s+from\s+trips\s+where\s+order_id\s*=\s*p_order_id/i.test(sqlContent),
        `Order-linked trip lookup not found in ${name}`
      ).toBe(true);
      expect(
        /if\s+v_trip_display_id\s+is\s+null[\s\S]*raise\s+exception[\s\S]*no\s+active\s+trip\s+found/i.test(sqlContent),
        `No-trip raise guard not found in ${name}`
      ).toBe(true);
      expect(
        /update\s+trips\s+set\s+status\s*=\s*'completed'/i.test(sqlContent),
        `Trips status update to completed not found in ${name}`
      ).toBe(true);
      expect(
        /update\s+trip_items\s+set\s+is_delivered\s*=\s*true/i.test(sqlContent),
        `Trip items update to is_delivered = true not found in ${name}`
      ).toBe(true);
      expect(
        /update\s+trip_stops\s+set\s+is_completed\s*=\s*true/i.test(sqlContent),
        `Trip stops update to is_completed = true not found in ${name}`
      ).toBe(true);
    }
  });

  it('verifies that complete_trip_tx persists net_earnings on the finalized trip row', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const migrationSqlPath = path.resolve(__dirname, '../../../../supabase/migrations/20260810120000_complete_trip_tx_write_net_earnings.sql');

    const setupSql = await fs.readFile(setupSqlPath, 'utf8');
    const migrationSql = await fs.readFile(migrationSqlPath, 'utf8');

    for (const [name, sqlContent] of [['supabase_setup.sql', setupSql], ['net_earnings migration', migrationSql]]) {
      expect(
        /update\s+trips[\s\S]*?set\s+status\s*=\s*'completed'[\s\S]*?net_earnings\s*=/i.test(sqlContent),
        `net_earnings write on trip completion not found in ${name}`
      ).toBe(true);
      expect(
        /net_earnings\s*=\s*(coalesce\(v_order\.bid_amount,\s*v_order\.total_amount\)|v_order\.total_amount)/i.test(sqlContent),
        `net_earnings must mirror the wallet credit payout basis in ${name}`
      ).toBe(true);
    }
  });

  it('verifies that order completion consumes the delivery OTP in the same RPC transaction', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const migrationSqlPath = path.resolve(__dirname, '../../../../supabase/migrations/20260624223000_make_delivery_otp_completion_atomic.sql');

    const setupSql = await fs.readFile(setupSqlPath, 'utf8');
    const migrationSql = await fs.readFile(migrationSqlPath, 'utf8');

    for (const [name, sqlContent] of [['supabase_setup.sql', setupSql], ['atomic OTP migration', migrationSql]]) {
      expect(
        /complete_trip_tx\s*\(\s*p_order_id\s+uuid\s*,\s*p_otp_id\s+uuid\s*[,)]/i.test(sqlContent),
        `OTP-aware complete_trip_tx signature not found in ${name}`
      ).toBe(true);
      expect(
        /update\s+delivery_otps\s+set\s+verified\s*=\s*true[\s\S]*where\s+id\s*=\s*p_otp_id[\s\S]*and\s+order_id\s*=\s*p_order_id/i.test(sqlContent),
        `Atomic delivery OTP update not found in ${name}`
      ).toBe(true);
      expect(
        /get\s+diagnostics\s+v_otp_updated\s*=\s*row_count/i.test(sqlContent),
        `Delivery OTP row-count guard not found in ${name}`
      ).toBe(true);
    }
  });

  it('contains the processed_batches table required for offline sync idempotency in both setup and migration SQL', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const migrationSqlPath = path.resolve(__dirname, '../../../../docs/migration_add_processed_batches.sql');

    const setupSql = await fs.readFile(setupSqlPath, 'utf8');
    const migrationSql = await fs.readFile(migrationSqlPath, 'utf8');

    for (const [name, sqlContent] of [['supabase_setup.sql', setupSql], ['migration_add_processed_batches.sql', migrationSql]]) {
      expect(/create\s+table\s+if\s+not\s+exists\s+processed_batches/i.test(sqlContent), `Table creation not found in ${name}`).toBe(true);
      expect(/unique\s*\(\s*user_id\s*,\s*idempotency_key\s*\)/i.test(sqlContent), `Composite unique constraint not found in ${name}`).toBe(true);
      expect(/alter\s+table\s+processed_batches\s+enable\s+row\s+level\s+security/i.test(sqlContent), `RLS enablement not found in ${name}`).toBe(true);
      expect(/create\s+policy\s+"Service role full access on processed_batches"\s+on\s+processed_batches/i.test(sqlContent), `Service role policy not found in ${name}`).toBe(true);
      expect(/create\s+policy\s+"Users view own processed batches"\s+on\s+processed_batches/i.test(sqlContent), `Users view own processed batches policy not found in ${name}`).toBe(true);
    }
  });

  it('contains durable escrow release failure metadata in setup and migration SQL', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const migrationSqlPath = path.resolve(__dirname, '../../../../supabase/migrations/20260624230000_track_escrow_release_failures.sql');

    const setupSql = await fs.readFile(setupSqlPath, 'utf8');
    const migrationSql = await fs.readFile(migrationSqlPath, 'utf8');

    for (const [name, sqlContent] of [['supabase_setup.sql', setupSql], ['escrow release migration', migrationSql]]) {
      expect(sqlContent).toMatch(/escrow_release_error\s+text/i);
      expect(sqlContent).toMatch(/escrow_release_attempts\s+integer\s+not\s+null\s+default\s+0/i);
      expect(sqlContent).toMatch(/escrow_release_last_attempt_at\s+timestamptz/i);
    }
  });

  it('drops the orphaned public.bids table and bid_status enum in favor of load_bids', async () => {
    const migrationSqlPath = path.resolve(
      __dirname,
      '../../../../supabase/migrations/20260802150000_drop_orphaned_bids_table.sql'
    );
    const sqlContent = await fs.readFile(migrationSqlPath, 'utf8');
    expect(sqlContent).toMatch(/drop\s+table\s+if\s+exists\s+public\.bids/i);
    expect(sqlContent).toMatch(/drop\s+type\s+if\s+exists\s+public\.bid_status/i);
  });

  it('verifies that database table counts and metadata are correct and in sync', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const schemaMdPath = path.resolve(__dirname, '../../../../docs/schema.md');

    const setupSql = await fs.readFile(setupSqlPath, 'utf8');
    const schemaMd = await fs.readFile(schemaMdPath, 'utf8');

    expect(setupSql).toContain('All 28 tables');
    expect(setupSql).toContain('PART 1: TABLE DEFINITIONS (28 tables)');
    expect(setupSql).toContain('26 tables with indexes');
    expect(schemaMd).toContain('28 tables · 4 RPC functions');
    expect(schemaMd).not.toContain('0 foreign keys');
  });
});
