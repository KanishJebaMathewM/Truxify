import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ORDER_READ_MODEL_TABLE,
  ORDER_READ_MODEL_COLUMNS,
  ORDER_READ_MODEL_PRIMARY_KEY,
  assertOrderReadModelRow,
  deriveOrderStatus,
  deriveEventTypeFromTimeline,
  OrderReadModelSchemaError,
} from '../../api/src/core/orders/read-model-schema.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');
const BASE_MIGRATION = path.join(MIGRATIONS_DIR, '20260806010000_create_orders_read_model.sql');
const UNIFY_MIGRATION = path.join(MIGRATIONS_DIR, '20260812000000_unify_order_read_model_schema.sql');

/**
 * Parses the column list out of the `create table` statement that owns the
 * `orders_read_model` table (20260806010000). The eventsourcing base table
 * carries order_id / payload / event_type / version / updated_at.
 */
function parseBaseColumnsFromMigration() {
  const sql = fs.readFileSync(BASE_MIGRATION, 'utf8');
  const start = sql.indexOf('create table if not exists orders_read_model (');
  assert.notEqual(start, -1, 'base migration must define the orders_read_model table');

  const bodyStart = sql.indexOf('(', start) + 1;
  const columns = [];
  for (const rawLine of sql.slice(bodyStart).split('\n')) {
    const line = rawLine.replace(/--.*$/, '').trim();
    if (line.startsWith(')')) break;
    if (line === '') continue;
    const match = line.match(/^([a-z_]+)\s/);
    if (match && !['primary', 'constraint'].includes(match[1])) {
      columns.push(match[1]);
    }
  }
  return columns;
}

/**
 * Parses the `add column if not exists` names out of the unification migration
 * (20260812000000). These are the canonical columns layered on top of the base
 * table: status and timeline.
 */
function parseAddedColumnsFromMigration() {
  const sql = fs.readFileSync(UNIFY_MIGRATION, 'utf8');
  const start = sql.indexOf('alter table orders_read_model');
  assert.notEqual(start, -1, 'unify migration must alter the orders_read_model table');

  const end = sql.indexOf(';', start);
  const block = sql.slice(start, end);
  const columns = [];
  for (const match of block.matchAll(/add column if not exists\s+([a-z_]+)/g)) {
    columns.push(match[1]);
  }
  return columns;
}

/**
 * Parses the INSERT target column list used by the migration's backfill from
 * the obsolete `order_read_models` table, so the data-migration mapping can be
 * mechanically compared against the canonical schema.
 */
function parseBackfillInsertColumns() {
  const sql = fs.readFileSync(UNIFY_MIGRATION, 'utf8');
  const match = sql.match(/insert into orders_read_model\s*\(([^)]+)\)/);
  assert.notEqual(match, null, 'unify migration must backfill orders_read_model from order_read_models');
  return match[1]
    .split(',')
    .map((col) => col.trim())
    .filter(Boolean);
}

/**
 * Guards against re-introducing the obsolete `order_read_models` table into
 * production code. Scans every backend .js file (excluding node_modules and
 * test directories) for a supabase `.from('order_read_models')` call.
 */
function findObsoleteTableReferences() {
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'test' || entry.name === 'uploads') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        const contents = fs.readFileSync(full, 'utf8');
        const lines = contents.split('\n');
        lines.forEach((line, i) => {
          if (/from\(\s*['"]order_read_models['"]/.test(line)) {
            hits.push(`${path.relative(backendDir, full)}:${i + 1}`);
          }
        });
      }
    }
  };
  walk(backendDir);
  return hits;
}

describe('order read-model schema — code/database consistency', () => {
  test('canonical table is orders_read_model', () => {
    assert.equal(ORDER_READ_MODEL_TABLE, 'orders_read_model');
  });

  test('canonical columns match the union of base + unify migration DDL exactly', () => {
    const ddlColumns = [...parseBaseColumnsFromMigration(), ...parseAddedColumnsFromMigration()];
    assert.deepEqual(
      [...ORDER_READ_MODEL_COLUMNS].sort(),
      [...ddlColumns].sort(),
      'ORDER_READ_MODEL_COLUMNS must equal the columns actually created by the migrations'
    );
    assert.equal(new Set(ddlColumns).size, ddlColumns.length, 'migrations must not declare duplicate columns');
    assert.equal(ORDER_READ_MODEL_PRIMARY_KEY, 'order_id');
  });

  test('the unify migration is additive and does not re-create the table', () => {
    const sql = fs.readFileSync(UNIFY_MIGRATION, 'utf8');
    assert.ok(
      !sql.includes('create table if not exists orders_read_model'),
      'the unify migration must not re-create orders_read_model (owned by 20260806010000)'
    );
  });

  test('the backfill INSERT maps onto exactly the canonical columns', () => {
    const backfillColumns = parseBackfillInsertColumns();
    assert.deepEqual(
      [...ORDER_READ_MODEL_COLUMNS].sort(),
      [...backfillColumns].sort(),
      'the migration backfill must write every canonical column'
    );
    assert.ok(
      !backfillColumns.includes('data'),
      'the obsolete `data` column must not appear in the canonical backfill'
    );
  });

  test('the canonical schema supersedes both legacy layouts', () => {
    const columns = new Set(ORDER_READ_MODEL_COLUMNS);
    // Legacy eventsourcing layout (orders_read_model v1).
    for (const col of ['order_id', 'payload', 'event_type', 'version', 'updated_at']) {
      assert.ok(columns.has(col), `legacy eventsourcing column ${col} must exist`);
    }
    // Legacy kafka layout (order_read_models).
    for (const col of ['order_id', 'status', 'timeline', 'updated_at']) {
      assert.ok(columns.has(col), `legacy kafka column ${col} must exist`);
    }
    // The old `data` column has no home in the canonical schema.
    assert.ok(!columns.has('data'), 'legacy `data` column must not exist in canonical schema');
  });

  test('no production code reads or writes the obsolete order_read_models table', () => {
    const hits = findObsoleteTableReferences();
    assert.deepEqual(
      hits,
      [],
      'production code must not reference `.from(\'order_read_models\')`: ' + hits.join(', ')
    );
  });
});

describe('assertOrderReadModelRow — projection/schema drift guard', () => {
  test('accepts a row built from canonical columns', () => {
    const row = {
      order_id: 'o1',
      payload: { status: 'CREATED' },
      event_type: 'ORDER_CREATED',
      version: 1,
      status: 'created',
      timeline: null,
      updated_at: '2026-08-12T00:00:00Z',
    };
    assert.equal(assertOrderReadModelRow(row), row);
  });

  test('rejects the legacy kafka row that wrote a nonexistent `data` column', () => {
    const legacyKafkaRow = {
      order_id: 'o1',
      status: 'created',
      data: {},
      timeline: [],
      updated_at: '2026-08-12T00:00:00Z',
    };
    assert.throws(
      () => assertOrderReadModelRow(legacyKafkaRow),
      (err) => err instanceof OrderReadModelSchemaError
    );
  });

  test('rejects rows missing order_id', () => {
    assert.throws(
      () => assertOrderReadModelRow({ payload: {}, updated_at: 't' }),
      (err) => err instanceof OrderReadModelSchemaError
    );
  });

  test('rejects unknown/misspelled columns', () => {
    assert.throws(
      () => assertOrderReadModelRow({ order_id: 'o1', payload: {}, status: 'x', updat_at: 't' }),
      (err) => err instanceof OrderReadModelSchemaError && err.message.includes('updat_at')
    );
  });
});

describe('deriveOrderStatus — canonical status normalization', () => {
  test('normalizes the uppercase aggregate status to lowercase', () => {
    assert.equal(deriveOrderStatus({ status: 'CREATED' }), 'created');
    assert.equal(deriveOrderStatus({ status: 'ASSIGNED' }), 'assigned');
    assert.equal(deriveOrderStatus({ status: 'CANCELLED' }), 'cancelled');
  });

  test('keeps the kafka lowercase status unchanged', () => {
    assert.equal(deriveOrderStatus({ status: 'in_transit' }), 'in_transit');
  });

  test('defaults to created when the state has no status', () => {
    assert.equal(deriveOrderStatus({ customerId: 'c' }), 'created');
  });

  test('returns null for a null/non-object state', () => {
    assert.equal(deriveOrderStatus(null), null);
  });
});

describe('deriveEventTypeFromTimeline', () => {
  test('returns the type of the last timeline entry', () => {
    const timeline = [
      { eventId: 'e1', type: 'ORDER_CREATED', timestamp: 't1' },
      { eventId: 'e2', type: 'DRIVER_ASSIGNED', timestamp: 't2' },
    ];
    assert.equal(deriveEventTypeFromTimeline(timeline), 'DRIVER_ASSIGNED');
  });

  test('returns null for an empty or malformed timeline', () => {
    assert.equal(deriveEventTypeFromTimeline([]), null);
    assert.equal(deriveEventTypeFromTimeline(null), null);
    assert.equal(deriveEventTypeFromTimeline([{}]), null);
  });
});
