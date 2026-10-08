import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { OrderRepository } from '../../src/repositories/orderRepository.js';
import { OrderValidationService } from '../../src/services/order/orderValidationService.js';

vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({ default: {
  getActiveSpan: () => ({ setAttributes() {} }),
  startWorkerSpan: () => ({ setAttributes() {} }), end() {},
} }));

const uuid = '111111aa-222b-433c-844d-55555555555e';
const displayId = '#FF20261006ABCDEFGHIJKL';
const fallbackId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
let database;

beforeAll(async () => {
  database = new PGlite();
  await database.exec('CREATE TABLE orders (id uuid PRIMARY KEY, order_display_id text UNIQUE, status text)');
  await database.query('INSERT INTO orders VALUES ($1, $2, $3), ($4, $5, $6)',
    [uuid, displayId, 'pending', '22222222-3333-4444-8555-666666666666', fallbackId, 'delivered']);
}, 30000);
afterAll(async () => { await database?.close(); });

// Execute real PostgreSQL comparisons behind the small Supabase query surface
// used here. In particular, comparing a display ID to orders.id raises 22P02.
function client() {
  const queries = [];
  const failures = new Map();
  return { queries, failures, from(table) {
    expect(table).toBe('orders');
    return { select(columns) { return { eq(column, value) { return {
      async maybeSingle() {
        queries.push({ column, value, columns });
        if (failures.has(column)) return { data: null, error: failures.get(column) };
        expect(['id', 'order_display_id']).toContain(column);
        expect(['*', 'id, status']).toContain(columns);
        try {
          const result = await database.query(`SELECT ${columns} FROM orders WHERE ${column} = $1`, [value]);
          return { data: result.rows[0] || null, error: null };
        } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
      },
    }; } }; } };
  } };
}

it('the PostgreSQL UUID column rejects a generated display ID with 22P02', async () => {
  await expect(database.query('SELECT * FROM orders WHERE id = $1', [displayId])).rejects.toMatchObject({ code: '22P02' });
});

for (const mode of ['repository', 'direct Supabase']) {
  describe(`order identifier resolution via ${mode}`, () => {
    let db;
    let service;
    beforeEach(() => {
      db = client();
      service = new OrderValidationService(mode === 'repository'
        ? { orderRepository: new OrderRepository(db) } : { supabase: db });
    });

    it.each([displayId, `TX-${displayId}`])('resolves display identifier %s without a UUID comparison', async identifier => {
      await expect(service.findOrderByIdOrDisplayId(identifier)).resolves.toMatchObject({ id: uuid, order_display_id: displayId });
      expect(db.queries.map(q => q.column)).toEqual(['order_display_id']);
    });

    it.each([uuid, `TX-${uuid}`, uuid.toUpperCase()])('preserves UUID identifier %s', async identifier => {
      await expect(service.findOrderByIdOrDisplayId(identifier)).resolves.toMatchObject({ id: uuid });
      expect(db.queries.map(q => q.column)).toEqual(['id']);
    });

    it('returns null for an unknown display identifier', async () => {
      await expect(service.findOrderByIdOrDisplayId('#FF20261006MISSINGORDER1')).resolves.toBeNull();
    });

    it('retains display fallback after a valid UUID query returns no row', async () => {
      await expect(service.findOrderByIdOrDisplayId(fallbackId)).resolves.toMatchObject({ order_display_id: fallbackId, status: 'delivered' });
      expect(db.queries.map(q => q.column)).toEqual(['id', 'order_display_id']);
    });

    it('does not mask a failed UUID query with display fallback', async () => {
      db.failures.set('id', { code: '42501', message: 'permission denied' });
      await expect(service.findOrderByIdOrDisplayId(uuid)).rejects.toMatchObject({ status: 500, payload: { details: 'permission denied' } });
      expect(db.queries.map(q => q.column)).toEqual(['id']);
    });

    it('preserves display query error reporting', async () => {
      db.failures.set('order_display_id', { code: '42501', message: 'display permission denied' });
      await expect(service.findOrderByIdOrDisplayId(displayId)).rejects.toMatchObject({ status: 500, payload: { details: 'display permission denied' } });
    });

    it('preserves selected columns for display lookup', async () => {
      await expect(service.findOrderByIdOrDisplayId(displayId, 'id, status')).resolves.toEqual({ id: uuid, status: 'pending' });
    });
  });
}

