
/**
 * Single source of truth for the order read-model schema.
 *
 * Both event-sourcing and Kafka CQRS projections must use this schema
 * before writing to the database.
 */

export const ORDER_READ_MODEL_TABLE = 'orders_read_model';

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
 * Canonical list of supported order statuses.
 */
export const ORDER_STATUSES = Object.freeze([
  'pending',
  'created',
  'truck_assigned',
  'assigned',
  'en_route_pickup',
  'arrived_pickup',
  'picked_up',
  'in_transit',
  'paid',
  'completed',
  'settled',
  'arriving',
  'delivered',
  'payment_released',
  'cancelled',
]);

const ORDER_STATUS_SET = new Set(ORDER_STATUSES);
const ORDER_COLUMN_SET = new Set(ORDER_READ_MODEL_COLUMNS);

/**
 * Validates an order read-model row before database insertion.
 */
export function assertOrderReadModelRow(row) {
  if (
    row === null ||
    typeof row !== 'object' ||
    Array.isArray(row)
  ) {
    throw new OrderReadModelSchemaError(
      'Order read-model row must be a valid object'
    );
  }

  const invalidColumns = Object.keys(row).filter(
    (key) => !ORDER_COLUMN_SET.has(key)
  );

  if (invalidColumns.length > 0) {
    throw new OrderReadModelSchemaError(
      `Invalid order read-model column(s): ${invalidColumns.join(', ')}`
    );
  }

  if (
    typeof row.order_id !== 'string' &&
    typeof row.order_id !== 'number'
  ) {
    throw new OrderReadModelSchemaError(
      'Order read-model row must include a valid order_id'
    );
  }

  if (String(row.order_id).trim() === '') {
    throw new OrderReadModelSchemaError(
      'Order read-model order_id cannot be empty'
    );
  }

  if (row.status !== undefined && row.status !== null) {
    if (
      typeof row.status !== 'string' ||
      !ORDER_STATUS_SET.has(row.status)
    ) {
      throw new OrderReadModelSchemaError(
        `Invalid order status: ${String(row.status)}`
      );
    }
  }

  return row;
}

/**
 * Normalizes and validates an order status.
 */
export function deriveOrderStatus(state) {
  if (
    state === null ||
    typeof state !== 'object' ||
    Array.isArray(state)
  ) {
    return null;
  }

  const raw = state.status;

  if (raw === undefined || raw === null) {
    return 'created';
  }

  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new OrderReadModelSchemaError(
      'Order status must be a non-empty string'
    );
  }

  const normalized = raw.trim().toLowerCase();

  if (!ORDER_STATUS_SET.has(normalized)) {
    throw new OrderReadModelSchemaError(
      `Unsupported order status: ${normalized}`
    );
  }

  return normalized;
}

/**
 * Returns the last event type from an order timeline.
 */
export function deriveEventTypeFromTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return null;
  }

  const last = timeline[timeline.length - 1];

  if (
    last === null ||
    typeof last !== 'object' ||
    Array.isArray(last)
  ) {
    return null;
  }

  const eventType = last.type ?? last.event_type;

  if (typeof eventType !== 'string' || eventType.trim() === '') {
    return null;
  }

  return eventType.trim();
}
