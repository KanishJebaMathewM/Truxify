import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildSummary,
  parseOpenApiRpcFunctions,
  parseRequiredTables,
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
      },
    });

    expect(functions).toEqual(new Set(['accept_bid_tx', 'withdraw_funds_tx']));
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
    });
  });
});

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
    
    // Validate operational/compliance foreign key constraints
    expect(sqlContent).toMatch(/order_timeline_order_display_id_fkey[\s\S]*references\s+orders\s*\(\s*order_display_id\s*\)[\s\S]*on delete cascade/i);
    expect(sqlContent).toMatch(/trip_items_trip_display_id_fkey[\s\S]*references\s+trips\s*\(\s*trip_display_id\s*\)[\s\S]*on delete cascade/i);
    expect(sqlContent).toMatch(/documents_user_id_fkey[\s\S]*references\s+profiles\s*\(\s*id\s*\)[\s\S]*on delete cascade/i);
    expect(sqlContent).toMatch(/driver_details_truck_id_fkey[\s\S]*references\s+trucks\s*\(\s*id\s*\)[\s\S]*on delete set null/i);

    // Validate indexes
    expect(sqlContent).toContain('idx_wallet_txn_order');
    expect(sqlContent).toContain('idx_wallet_txn_trip');
    expect(sqlContent).toContain('idx_maint_tickets_driver');
    expect(sqlContent).toContain('idx_driver_details_truck');
  });

  it('contains the unique constraint on earnings_daily(driver_id, day_date)', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const sqlContent = await fs.readFile(setupSqlPath, 'utf8');
    
    // Check for table creation unique constraint
    const hasUniqueConstraint = /constraint\s+earnings_daily_driver_day_unique\s+unique\s*\(\s*driver_id\s*,\s*day_date\s*\)/i.test(sqlContent);
    expect(hasUniqueConstraint).toBe(true);
  });

  it('verifies that complete_trip_tx uses UPSERT behavior with ON CONFLICT', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const sqlContent = await fs.readFile(setupSqlPath, 'utf8');

    // Find all insert statements into earnings_daily in complete_trip_tx function definitions
    // and ensure they have ON CONFLICT (driver_id, day_date) DO UPDATE
    const insertMatches = [...sqlContent.matchAll(/insert\s+into\s+earnings_daily[\s\S]*?on\s+conflict\s*\(\s*driver_id\s*,\s*day_date\s*\)\s*do\s+update/gi)];
    
    // There should be at least two such insert statements matching the upsert behavior across the RPC overloads
    expect(insertMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('verifies that complete_trip_tx(p_order_id uuid) updates trips, trip_items, and trip_stops on successful verification', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const migrationSqlPath = path.resolve(__dirname, '../../../../docs/migration_complete_trip_update.sql');

    const setupSql = await fs.readFile(setupSqlPath, 'utf8');
    const migrationSql = await fs.readFile(migrationSqlPath, 'utf8');

    for (const [name, sqlContent] of [['supabase_setup.sql', setupSql], ['migration_complete_trip_update.sql', migrationSql]]) {
      // 1. Check for active trip lookup query
      expect(
        /select\s+trip_display_id\s+into\s+v_trip_display_id\s+from\s+trips\s+where\s+driver_id\s*=\s*\w+\.driver_id\s+and\s+status\s*=\s*'active'/i.test(sqlContent),
        `Active trip lookup not found in ${name}`
      ).toBe(true);

      // 2. Check for trips status update to completed
      expect(
        /update\s+trips\s+set\s+status\s*=\s*'completed'/i.test(sqlContent),
        `Trips status update to completed not found in ${name}`
      ).toBe(true);

      // 3. Check for trip_items delivered update
      expect(
        /update\s+trip_items\s+set\s+is_delivered\s*=\s*true/i.test(sqlContent),
        `Trip items update to is_delivered = true not found in ${name}`
      ).toBe(true);

      // 4. Check for trip_stops completed update
      expect(
        /update\s+trip_stops\s+set\s+is_completed\s*=\s*true/i.test(sqlContent),
        `Trip stops update to is_completed = true not found in ${name}`
      ).toBe(true);
    }
  });

  it('contains the processed_batches table required for offline sync idempotency in both setup and migration SQL', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const migrationSqlPath = path.resolve(__dirname, '../../../../docs/migration_add_processed_batches.sql');

    const setupSql = await fs.readFile(setupSqlPath, 'utf8');
    const migrationSql = await fs.readFile(migrationSqlPath, 'utf8');

    for (const [name, sqlContent] of [['supabase_setup.sql', setupSql], ['migration_add_processed_batches.sql', migrationSql]]) {
      // 1. Table creation check
      expect(
        /create\s+table\s+if\s+not\s+exists\s+processed_batches/i.test(sqlContent),
        `Table creation not found in ${name}`
      ).toBe(true);

      // 2. User-scoped composite unique constraint (user_id, idempotency_key)
      expect(
        /unique\s*\(\s*user_id\s*,\s*idempotency_key\s*\)/i.test(sqlContent),
        `Composite unique constraint (user_id, idempotency_key) not found in ${name}`
      ).toBe(true);

      // 3. Row Level Security enablement
      expect(
        /alter\s+table\s+processed_batches\s+enable\s+row\s+level\s+security/i.test(sqlContent),
        `RLS enablement not found in ${name}`
      ).toBe(true);

      // 4. Service role and authenticated user policies
      expect(
        /create\s+policy\s+"Service role full access on processed_batches"\s+on\s+processed_batches/i.test(sqlContent),
        `Service role policy not found in ${name}`
      ).toBe(true);

      expect(
        /create\s+policy\s+"Users view own processed batches"\s+on\s+processed_batches/i.test(sqlContent),
        `Users view own processed batches policy not found in ${name}`
      ).toBe(true);
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

  it('verifies that database table counts and metadata are correct and in sync', async () => {
    const setupSqlPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    const schemaMdPath = path.resolve(__dirname, '../../../../docs/schema.md');

    const setupSql = await fs.readFile(setupSqlPath, 'utf8');
    const schemaMd = await fs.readFile(schemaMdPath, 'utf8');

    // supabase_setup.sql counts
    expect(setupSql).toContain('All 28 tables');
    expect(setupSql).toContain('PART 1: TABLE DEFINITIONS (28 tables)');
    expect(setupSql).toContain('26 tables with indexes');

    // schema.md counts
    expect(schemaMd).toContain('28 tables · 4 RPC functions');
    expect(schemaMd).not.toContain('0 foreign keys');
  });
});
