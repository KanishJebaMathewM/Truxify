/**
 * Coverage for the composite indexes on `trips` and the migration that adds
 * them.
 *
 * `trips` carried only single-column indexes on driver_id, status and
 * trip_date. Every driver-facing read filters on the first two together and
 * orders by the third, which no single-column index can satisfy — Postgres
 * combined indexes via a bitmap AND and then sorted explicitly.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, beforeAll } from 'vitest';
import {
  REQUIRED_COMPOSITE_INDEXES,
  checkCompositeIndexes,
} from '../../scripts/verify-db-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION = path.join(
  REPO_ROOT,
  'supabase/migrations/20260805130000_add_trips_composite_indexes.sql'
);

describe('checkCompositeIndexes', () => {
  it('reports every declared index as present when all exist', () => {
    const names = REQUIRED_COMPOSITE_INDEXES.map((i) => i.name);
    const results = checkCompositeIndexes(names);

    expect(results).toHaveLength(REQUIRED_COMPOSITE_INDEXES.length);
    expect(results.every((r) => r.present)).toBe(true);
  });

  it('flags a missing index', () => {
    const results = checkCompositeIndexes(['idx_trips_driver_display']);
    const missing = results.filter((r) => !r.present).map((r) => r.name);

    expect(missing).toContain('idx_trips_driver_status_date');
  });

  it('flags all indexes as missing on an empty database', () => {
    expect(checkCompositeIndexes([]).every((r) => !r.present)).toBe(true);
  });

  it('tolerates null and undefined input', () => {
    expect(() => checkCompositeIndexes(null)).not.toThrow();
    expect(checkCompositeIndexes(undefined).every((r) => !r.present)).toBe(true);
  });

  it('ignores unrelated indexes', () => {
    const results = checkCompositeIndexes(['idx_orders_status', 'idx_profiles_phone']);
    expect(results.every((r) => !r.present)).toBe(true);
  });

  it('declares the columns each index covers, in order', () => {
    const composite = REQUIRED_COMPOSITE_INDEXES.find(
      (i) => i.name === 'idx_trips_driver_status_date'
    );
    // Column order is what makes the index usable: driver_id and status are
    // equality predicates, trip_date provides the ordering.
    expect(composite.columns).toEqual(['driver_id', 'status', 'trip_date']);
  });

  it('explains what each index is for', () => {
    for (const index of REQUIRED_COMPOSITE_INDEXES) {
      expect(index.servedBy, `${index.name} should document its purpose`).toBeTruthy();
      expect(index.table).toBe('trips');
    }
  });
});

describe('composite index migration', () => {
  let sql;

  beforeAll(async () => {
    sql = await fs.readFile(MIGRATION, 'utf8');
  });

  it('is wrapped in a transaction, per CONTRIBUTING.md', () => {
    expect(sql).toMatch(/^\s*BEGIN;/m);
    expect(sql).toMatch(/COMMIT;\s*$/);
  });

  it('is idempotent so it is safe to re-run', () => {
    const creates = sql.match(/CREATE INDEX/gi) || [];
    const guarded = sql.match(/CREATE INDEX IF NOT EXISTS/gi) || [];
    expect(guarded).toHaveLength(creates.length);
  });

  it('creates every index the verifier requires', () => {
    for (const index of REQUIRED_COMPOSITE_INDEXES) {
      expect(sql, `migration should create ${index.name}`).toContain(index.name);
    }
  });

  it('orders trip_date descending to match the dominant query', () => {
    expect(sql).toMatch(/idx_trips_driver_status_date[\s\S]*?trip_date DESC/);
  });

  it('is purely additive — drops nothing', () => {
    // A DROP here would be risky: the repo already has inconsistent index
    // naming between the migrations and the schema verifier.
    expect(sql).not.toMatch(/DROP\s+INDEX(?!\s+IF\s+EXISTS\s+--)/i);
  });

  it('records why each index exists', () => {
    expect(sql).toMatch(/driverRoutes\.js/);
    expect(sql).toMatch(/COMMENT ON INDEX/i);
  });
});
