/**
 * Single source of truth for the order read-model schema.
 *
 * Both order read-model projections — the eventsourcing projection
 * (backend/eventsourcing/event-store.js) and the Kafka CQRS projection
 * (backend/kafka/cqrs/order.read.model.js) — must build their upsert rows
 * exclusively from ORDER_READ_MODEL_COLUMNS and validate them with
 * assertOrderReadModelRow() before writing. The canonical DDL is the union of
 * the base table (supabase/migrations/20260806010000_create_orders_read_model.sql)
 * and the columns added by
 * supabase/migrations/20260812000000_unify_order_read_model_schema.sql
 * (`status`, `timeline`); the schema-consistency test
 * (backend/eventsourcing/test/read-model-schema.test.js) fails when this module
 * and the migrations drift apart.
 *
 * The obsolete `order_read_models` table (status / data / timeline) was
 * consolidated into `orders_read_model` by that migration: `data` moved into
 * `payload`, and `status` / `timeline` were added as canonical columns. No
 * projection may reference the old table or the old column layout.
 *
 * This module is deliberately dependency-free so any package or test runner
 * in the repository can import it.
 */

export const ORDER_READ_MODEL_TABLE = 'orders_read_model';

/** Columns of the canonical `orders_read_model` table, in DDL order. */
export const ORDER_READ_MODEL_COLUMNS = Object.freeze([
  'order_id',
  'payload',
  'event_type',
  'version',
  'status',
  'timeline',
  'updated_at',
]);

export const ORDER_READ_MODEL_PRIMARY_KEY = 'order_id';

export class OrderReadModelSchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OrderReadModelSchemaError';
    this.code = 'ORDER_READ_MODEL_SCHEMA_DRIFT';
  }
}

/**
 * Projection/schema drift guard. Called by both projections before an upsert.
 * Throws when a projection attempts to write a column that does not exist in
 * the canonical schema, so a schema mismatch is loud instead of being silently
 * logged (the failure mode that left projections empty historically).
 */
export function assertOrderReadModelRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new OrderReadModelSchemaError('Order read-model row must be an object');
  }
  const invalid = Object.keys(row).filter(
    (key) => !ORDER_READ_MODEL_COLUMNS.includes(key)
  );
  if (invalid.length > 0) {
    throw new OrderReadModelSchemaError(
      `Order read-model projection writes column(s) not present in the canonical schema: ${invalid.join(', ')}`
    );
  }
  if (!row.order_id) {
    throw new OrderReadModelSchemaError(
      'Order read-model projection must include the order_id column'
    );
  }
  return row;
}

/**
 * Normalizes a state/snapshot status into the shared `status` column value.
 * The eventsourcing aggregate reducer produces uppercase statuses (CREATED,
 * ASSIGNED, CANCELLED) while the Kafka snapshot builder produces lowercase
 * ones (created, assigned, ...); the canonical column stores the lowercase
 * form so `status`-column filters work across both writers.
 */
export function deriveOrderStatus(state) {
  if (!state || typeof state !== 'object') {
    return null;
  }
  const raw = state.status;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return 'created';
  }
  return raw.trim().toLowerCase();
}

/**
 * Best-effort last event type derived from an order timeline (used by the
 * Kafka CQRS projection, whose snapshot has no explicit event_type/version).
 */
export function deriveEventTypeFromTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return null;
  }
  const last = timeline[timeline.length - 1];
  if (!last || typeof last !== 'object') {
    return null;
  }
  return last.type || last.event_type || null;
}
