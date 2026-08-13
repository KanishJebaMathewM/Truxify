/**
 * Event-sourcing core: normalization, replay, optimistic concurrency and
 * snapshotting, expressed against an injected persistence interface.
 *
 * This module has ZERO external dependencies so it can be imported, executed
 * and tested on its own (see `npm test` in this package). The adapter in
 * event-store.js wires it to Supabase, Kafka and telemetry.
 *
 * Persistence contract (`db`):
 *   - fetchEventStream(aggregateId)      -> Promise<raw rows ordered by version>
 *   - fetchLatestVersion(aggregateId)    -> Promise<{ version } | null>
 *   - insertEvent(row)                   -> Promise<{ data: rows, error }>
 *   - fetchSnapshot(aggregateId)         -> Promise<row | null>
 *   - upsertSnapshot(row)                -> Promise<{ error }>
 *
 * insertEvent MUST run against a uniqueness guarantee on
 * (aggregate_id, version) — the database constraint is the final safety
 * mechanism against duplicate versions. When the target version already
 * exists the adapter returns `{ data: [] }` (e.g. INSERT ... ON CONFLICT
 * DO NOTHING) so the core can raise a typed concurrency conflict.
 *
 * Row format (database boundary):
 *   { event_id, event_type, aggregate_id, payload, version, timestamp }
 *
 * Domain event format (replay boundary):
 *   { id, type, aggregateId, payload, version, timestamp }
 */
import {
  EventStoreError,
  EventStoreVersionConflictError,
  EventStoreSnapshotError,
  EventStoreValidationError,
  toEventStoreError,
} from './errors.js';

import { randomUUID } from 'node:crypto';

export const SNAPSHOT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// 1. THE SINGLE NORMALIZATION BOUNDARY
// ---------------------------------------------------------------------------

/**
 * Converts a persisted database row into a domain event. This is the only
 * place in the codebase where `event_id` -> `id`, `event_type` -> `type` and
 * `aggregate_id` -> `aggregateId` are translated. Historical rows keep their
 * original column layout forever; nothing below ever needs to know about it.
 *
 * Rows that are already in domain shape are passed through untouched, which
 * keeps in-memory events and database-loaded events interchangeable.
 */
export function normalizeEventRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  // Already a domain event (e.g. produced by storeEvent in this process).
  if (row.type && !row.event_type && row.aggregateId !== undefined) {
    return { ...row };
  }

  return {
    id: row.event_id ?? row.id,
    type: row.event_type ?? row.type,
    aggregateId: row.aggregate_id ?? row.aggregateId,
    payload: row.payload ?? {},
    version: Number(row.version),
    timestamp: row.timestamp ?? row.created_at,
  };
}

/**
 * Inverse of normalizeEventRow — domain event to database row. Only used when
 * persisting new events; historical rows are never rewritten.
 */
export function toEventRow(event) {
  return {
    event_id: event.id,
    event_type: event.type,
    aggregate_id: event.aggregateId,
    payload: event.payload ?? {},
    version: event.version,
    timestamp: event.timestamp,
    created_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 2. AGGREGATE REDUCER
// ---------------------------------------------------------------------------

/**
 * Pure reducer: (state, domainEvent) -> nextState. Kept side-effect free so
 * replay is deterministic regardless of cache temperature or process history.
 */
export function applyEvent(state, event) {
  switch (event.type) {
    case 'ORDER_CREATED':
      return {
        ...state,
        ...event.payload,
        status: 'CREATED',
        version: event.version,
      };
    case 'ORDER_UPDATED':
      return {
        ...state,
        ...event.payload,
        version: event.version,
      };
    case 'ORDER_CANCELLED':
      return {
        ...state,
        status: 'CANCELLED',
        cancelledAt: event.payload.cancelledAt,
        reason: event.payload.reason,
        version: event.version,
      };
    case 'DRIVER_ASSIGNED':
      return {
        ...state,
        driverId: event.payload.driverId,
        status: 'ASSIGNED',
        version: event.version,
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// 3. CORE
// ---------------------------------------------------------------------------

export class EventStoreCore {
  constructor({
    db,
    logger = console,
    snapshotThreshold = 50,
    snapshotSchemaVersion = SNAPSHOT_SCHEMA_VERSION,
    now = () => new Date().toISOString(),
    uuid = () => randomUUID(),
  }) {
    if (!db) {
      throw new EventStoreError('EventStoreCore requires a persistence adapter (`db`).');
    }
    this.db = db;
    this.logger = logger;
    this.snapshotThreshold = Number(snapshotThreshold) || 50;
    this.snapshotSchemaVersion = snapshotSchemaVersion;
    this._now = now;
    this._uuid = uuid;

    this.eventStreams = new Map(); // aggregateId -> domain events (in-memory cache)
    this.snapshots = new Map(); // aggregateId -> validated snapshot
  }

  // ---- Cache --------------------------------------------------------------

  /**
   * Clears in-memory state. Used by cold-start tests and by long-running
   * workers that want to force a fresh read from the database.
   */
  clearCache(aggregateId) {
    if (aggregateId === undefined || aggregateId === null) {
      this.eventStreams.clear();
      this.snapshots.clear();
      return;
    }
    this.eventStreams.delete(aggregateId);
    this.snapshots.delete(aggregateId);
  }

  // ---- Event stream -------------------------------------------------------

  async getEventStream(aggregateId) {
    if (this.eventStreams.has(aggregateId)) {
      return this.eventStreams.get(aggregateId);
    }

    const rawRows = await this.db.fetchEventStream(aggregateId);
    const events = (rawRows || [])
      .map(normalizeEventRow)
      .filter(Boolean)
      .sort((a, b) => Number(a.version) - Number(b.version));

    this.eventStreams.set(aggregateId, events);
    return events;
  }

  /**
   * Latest committed version from the database — deliberately bypasses the
   * in-memory cache so the value is authoritative across processes/instances.
   */
  async getLatestVersion(aggregateId) {
    const row = await this.db.fetchLatestVersion(aggregateId);
    const version = row && row.version !== null && row.version !== undefined ? Number(row.version) : null;
    return version === null || Number.isNaN(version) ? null : version;
  }

  // ---- Aggregate reconstruction ------------------------------------------

  /**
   * Reconstructs aggregate state from the latest valid snapshot plus only the
   * events newer than it. Warm cache, cold cache and database rows all flow
   * through the same reducer, so the result is identical in every case.
   *
   * Returns null when the aggregate has never been created.
   */
  async getAggregateState(aggregateId) {
    const snapshot = await this.getSnapshot(aggregateId);
    const snapshotVersion = snapshot ? Number(snapshot.version) : 0;
    let state = snapshot ? { ...snapshot.state } : { id: aggregateId, version: 0 };

    const events = await this.getEventStream(aggregateId);
    const eventsToApply = events
      .filter((event) => Number(event.version) > snapshotVersion)
      .sort((a, b) => Number(a.version) - Number(b.version));

    if (!snapshot && eventsToApply.length === 0) {
      return null;
    }

    for (const event of eventsToApply) {
      state = applyEvent(state, event);
    }
    return state;
  }

  /**
   * Rebuilds an aggregate purely from pre-fetched database rows (used by the
   * rebuild endpoint so it does not re-query per aggregate). Still consults
   * the latest valid snapshot so the rows older than the snapshot are skipped.
   */
  async rebuildFromRows(aggregateId, rawRows) {
    const snapshot = await this.getSnapshot(aggregateId);
    const snapshotVersion = snapshot ? Number(snapshot.version) : 0;
    let state = snapshot ? { ...snapshot.state } : { id: aggregateId, version: 0 };

    const events = (rawRows || [])
      .map(normalizeEventRow)
      .filter(Boolean)
      .filter((event) => Number(event.version) > snapshotVersion)
      .sort((a, b) => Number(a.version) - Number(b.version));

    if (!snapshot && events.length === 0) {
      return null;
    }

    for (const event of events) {
      state = applyEvent(state, event);
    }
    return state;
  }

  // ---- Optimistic concurrency --------------------------------------------

  /**
   * Appends one event under optimistic concurrency control.
   *
   *   current === expectedVersion  ->  event stored at expectedVersion + 1
   *   current !== expectedVersion  ->  EventStoreVersionConflictError
   *
   * The read-then-write check is advisory; the real safety net is the
   * database uniqueness on (aggregate_id, version). If a concurrent writer
   * commits the same version between our read and our insert, the insert is a
   * no-op (`data: []`) and we raise a typed conflict.
   */
  async appendEvent(aggregateId, event, expectedVersion) {
    if (!aggregateId) {
      throw new EventStoreValidationError('appendEvent requires an aggregateId');
    }
    if (!event || typeof event.type !== 'string' || event.type.length === 0) {
      throw new EventStoreValidationError('appendEvent requires an event with a non-empty `type`');
    }

    const currentVersion = await this.getLatestVersion(aggregateId);
    const hasExpected = expectedVersion !== undefined && expectedVersion !== null;

    if (hasExpected) {
      const current = currentVersion === null ? 0 : currentVersion;
      if (current !== expectedVersion) {
        throw new EventStoreVersionConflictError({
          aggregateId,
          expectedVersion,
          currentVersion: current,
          reason: 'aggregate version advanced since the command was evaluated',
        });
      }
    }

    const nextVersion = hasExpected
      ? expectedVersion + 1
      : (currentVersion === null ? 0 : currentVersion) + 1;

    const domainEvent = {
      id: event.id || this._uuid(),
      type: event.type,
      aggregateId,
      payload: event.payload ?? {},
      version: nextVersion,
      timestamp: event.timestamp || this._now(),
    };

    const { data, error } = await this.db.insertEvent(toEventRow(domainEvent));

    if (error) {
      const typed = toEventStoreError(error, { aggregateId });
      this.logger.error?.('Event append failed:', typed);
      throw typed;
    }

    if (!data || (Array.isArray(data) && data.length === 0)) {
      // Unique (aggregate_id, version) rejected our insert: a concurrent
      // request already claimed nextVersion. Never expose the raw conflict.
      throw new EventStoreVersionConflictError({
        aggregateId,
        expectedVersion,
        currentVersion: nextVersion,
        reason: 'a concurrent command already committed this version',
      });
    }

    // Persisted first, cache second — never cache a phantom event.
    this._cacheEvent(aggregateId, domainEvent);
    return domainEvent;
  }

  _cacheEvent(aggregateId, event) {
    if (!this.eventStreams.has(aggregateId)) {
      this.eventStreams.set(aggregateId, []);
    }
    const stream = this.eventStreams.get(aggregateId);
    if (!stream.some((e) => e.version === event.version)) {
      stream.push(event);
      stream.sort((a, b) => Number(a.version) - Number(b.version));
    }
  }

  // ---- Snapshots ----------------------------------------------------------

  /**
   * Loads the latest snapshot for an aggregate and validates it. An invalid
   * or incompatible snapshot is treated as absent so callers fall back to a
   * full replay instead of trusting corrupted state.
   */
  async getSnapshot(aggregateId) {
    if (this.snapshots.has(aggregateId)) {
      return this.snapshots.get(aggregateId);
    }

    let row = null;
    try {
      row = await this.db.fetchSnapshot(aggregateId);
    } catch (error) {
      this.logger.error?.(`Snapshot read failed for ${aggregateId}:`, error);
      return null;
    }

    if (!row) {
      this.snapshots.set(aggregateId, null);
      return null;
    }

    const snapshot = this._validateSnapshot(row);
    this.snapshots.set(aggregateId, snapshot);
    return snapshot;
  }

  _validateSnapshot(row) {
    if (!row || typeof row !== 'object') {
      return null;
    }
    const version = Number(row.version);
    if (!Number.isInteger(version) || version < 0) {
      return null;
    }
    if (!row.state || typeof row.state !== 'object' || Array.isArray(row.state)) {
      return null;
    }
    if (row.snapshot_version !== undefined && row.snapshot_version !== null) {
      const schemaVersion = Number(row.snapshot_version);
      if (Number.isNaN(schemaVersion) || schemaVersion > this.snapshotSchemaVersion) {
        return null;
      }
    }
    return {
      aggregateId: row.aggregate_id ?? row.aggregateId,
      version,
      state: row.state,
      snapshotVersion: Number(row.snapshot_version) || this.snapshotSchemaVersion,
      createdAt: row.created_at ?? row.timestamp,
    };
  }

  async takeSnapshot(aggregateId, state, version) {
    const snapshotVersion = version !== undefined && version !== null ? Number(version) : Number(state?.version);
    if (!Number.isInteger(snapshotVersion) || snapshotVersion < 0) {
      throw new EventStoreSnapshotError(`Cannot snapshot ${aggregateId}: invalid version ${snapshotVersion}`, {
        aggregateId,
      });
    }
    if (!state || typeof state !== 'object') {
      throw new EventStoreSnapshotError(`Cannot snapshot ${aggregateId}: state is not an object`, {
        aggregateId,
      });
    }

    const snapshot = {
      aggregateId,
      version: snapshotVersion,
      state,
      snapshotVersion: this.snapshotSchemaVersion,
      timestamp: this._now(),
    };

    const { error } = await this.db.upsertSnapshot({
      aggregate_id: aggregateId,
      version: snapshotVersion,
      state,
      snapshot_version: this.snapshotSchemaVersion,
      timestamp: snapshot.timestamp,
    });

    if (error) {
      throw toEventStoreError(error, { aggregateId });
    }

    this.snapshots.set(aggregateId, {
      aggregateId,
      version: snapshotVersion,
      state,
      snapshotVersion: this.snapshotSchemaVersion,
      createdAt: snapshot.timestamp,
    });
    return snapshot;
  }

  /**
   * Snapshot policy: snapshot when the aggregate has grown by
   * `snapshotThreshold` events since its last snapshot. Never snapshot every
   * event, and never delete the underlying event history.
   */
  async checkSnapshot(aggregateId) {
    const events = await this.getEventStream(aggregateId);
    if (!events || events.length === 0) {
      return;
    }
    const latestVersion = Math.max(...events.map((e) => Number(e.version) || 0));
    const snapshot = await this.getSnapshot(aggregateId);
    const snapshotVersion = snapshot ? Number(snapshot.version) : 0;

    if (latestVersion - snapshotVersion >= this.snapshotThreshold) {
      const state = await this.getAggregateState(aggregateId);
      await this.takeSnapshot(aggregateId, state, latestVersion);
      this.logger.info?.(`Snapshot taken for ${aggregateId} at version ${latestVersion}`);
      return true;
    }
    return false;
  }
}

export default EventStoreCore;
