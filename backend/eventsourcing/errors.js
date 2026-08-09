/**
 * Typed, domain-specific errors for the event-sourcing package.
 *
 * Every error that escapes the event store is one of these classes so that
 * callers (HTTP routes, workers, tests) can branch on `error.code` instead of
 * sniffing SQL/Supabase internals. No raw database exception is ever meant to
 * cross this boundary — adapters must translate persistence failures into
 * these classes before propagating.
 */

const HTTP_STATUS = {
  CONFLICT: 409,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  INTERNAL: 500,
};

export class EventStoreError extends Error {
  constructor(message, { code = 'EVENT_STORE_ERROR', status = HTTP_STATUS.INTERNAL, cause } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    if (cause) {
      this.cause = cause;
    }
  }

  get httpStatus() {
    return this.status;
  }

  toPublic() {
    return {
      code: this.code,
      error: this.message,
    };
  }
}

/**
 * Raised when a command cannot be applied because the aggregate's version
 * moved since the command read it (or because a concurrent command already
 * claimed the target version). Maps to HTTP 409 Conflict.
 */
export class EventStoreVersionConflictError extends EventStoreError {
  constructor({ aggregateId, expectedVersion, currentVersion, reason } = {}) {
    const expected = expectedVersion === undefined || expectedVersion === null ? 'unknown' : expectedVersion;
    const current = currentVersion === undefined || currentVersion === null ? 'unknown' : currentVersion;
    const detail = reason || `aggregate=${aggregateId} expected version ${expected}, found ${current}`;
    super(`Version conflict: ${detail}`, {
      code: 'EVENT_VERSION_CONFLICT',
      status: HTTP_STATUS.CONFLICT,
    });
    this.aggregateId = aggregateId;
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}

export class EventStoreMissingAggregateError extends EventStoreError {
  constructor(aggregateId) {
    super(`Aggregate not found: ${aggregateId}`, {
      code: 'EVENT_AGGREGATE_NOT_FOUND',
      status: HTTP_STATUS.NOT_FOUND,
    });
    this.aggregateId = aggregateId;
  }
}

export class EventStoreInvalidAggregateError extends EventStoreError {
  constructor(aggregateId, reason) {
    super(`Aggregate ${aggregateId} is invalid: ${reason}`, {
      code: 'EVENT_AGGREGATE_INVALID',
      status: HTTP_STATUS.BAD_REQUEST,
    });
    this.aggregateId = aggregateId;
  }
}

export class EventStoreSnapshotError extends EventStoreError {
  constructor(message, { aggregateId, code = 'EVENT_SNAPSHOT_ERROR', cause } = {}) {
    super(message, { code, status: HTTP_STATUS.INTERNAL, cause });
    this.aggregateId = aggregateId;
  }
}

export class EventStorePersistenceError extends EventStoreError {
  constructor(message, { cause } = {}) {
    super(message, { code: 'EVENT_PERSISTENCE_ERROR', cause });
  }
}

export class EventStoreValidationError extends EventStoreError {
  constructor(message) {
    super(message, { code: 'EVENT_VALIDATION_ERROR', status: HTTP_STATUS.BAD_REQUEST });
  }
}

/**
 * Best-effort translation of a persistence error into a typed domain error.
 * Adapters call this instead of rethrowing Supabase/PostgreSQL objects.
 */
export function toEventStoreError(error, { context } = {}) {
  if (error instanceof EventStoreError) {
    return error;
  }

  const message = (error && error.message) || 'Unknown event-store failure';
  const isUniqueViolation =
    (error && error.code === '23505') || // PostgreSQL unique_violation
    /duplicate key value violates unique constraint/i.test(message) ||
    /unique constraint/i.test(message) ||
    /ON CONFLICT/i.test(message);

  if (isUniqueViolation) {
    const aggregateId = context && context.aggregateId;
    return new EventStoreVersionConflictError({
      aggregateId,
      reason: 'database rejected a duplicate (aggregate_id, version)',
    });
  }

  return new EventStorePersistenceError('Event store persistence failure', { cause: error });
}
