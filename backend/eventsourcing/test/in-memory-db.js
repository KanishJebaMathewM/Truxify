/**
 * In-memory implementation of the EventStoreCore persistence contract.
 *
 * It mirrors the PostgreSQL migration for event_store:
 *   - unique (aggregate_id, version): insertEvent returns `{ data: [] }` when
 *     the target version already exists, exactly like
 *     INSERT ... ON CONFLICT (aggregate_id, version) DO NOTHING.
 *   - one snapshot per aggregate, upserted on aggregate_id.
 *
 * Seeded rows are stored in the same column layout as the `event_store` table
 * (event_id / event_type / aggregate_id / payload / version / timestamp) so
 * tests exercise the real normalization boundary.
 */
export class InMemoryDb {
  constructor({ initialEvents = [], initialSnapshots = [] } = {}) {
    this.rows = [];
    this.snapshots = [];
    this.byKey = new Map(); // `${aggregate_id}\0${version}` -> row
    this.insertAttempts = 0;

    for (const row of initialEvents) {
      this._storeRow(row);
    }
    for (const snap of initialSnapshots) {
      this._storeSnapshot(snap);
    }
  }

  static key(aggregateId, version) {
    return `${aggregateId}\u0000${version}`;
  }

  _storeRow(row) {
    const key = InMemoryDb.key(row.aggregate_id, row.version);
    if (!this.byKey.has(key)) {
      this.byKey.set(key, row);
      this.rows.push(row);
    }
    return this.byKey.get(key);
  }

  _storeSnapshot(snap) {
    const existing = this.snapshots.find((s) => s.aggregate_id === snap.aggregate_id);
    if (existing) {
      Object.assign(existing, snap);
    } else {
      this.snapshots.push({ ...snap });
    }
  }

  async fetchEventStream(aggregateId) {
    return this.rows
      .filter((r) => r.aggregate_id === aggregateId)
      .sort((a, b) => a.version - b.version);
  }

  async fetchLatestVersion(aggregateId) {
    const versions = this.rows
      .filter((r) => r.aggregate_id === aggregateId)
      .map((r) => r.version);
    if (versions.length === 0) {
      return null;
    }
    return { version: Math.max(...versions) };
  }

  async insertEvent(row) {
    this.insertAttempts += 1;
    const key = InMemoryDb.key(row.aggregate_id, row.version);
    if (this.byKey.has(key)) {
      // Simulates the database rejecting a duplicate (aggregate_id, version).
      return { data: [], error: null };
    }
    this._storeRow(row);
    return { data: [row], error: null };
  }

  async fetchSnapshot(aggregateId) {
    const matches = this.snapshots
      .filter((s) => s.aggregate_id === aggregateId)
      .sort((a, b) => b.version - a.version);
    return matches[0] || null;
  }

  async upsertSnapshot(row) {
    this._storeSnapshot(row);
    return { error: null };
  }

  rawRows(aggregateId) {
    return this.rows.filter((r) => r.aggregate_id === aggregateId);
  }

  hasVersion(aggregateId, version) {
    return this.byKey.has(InMemoryDb.key(aggregateId, version));
  }
}

/** Builds a database-format event row for seeding. */
export function dbRow({ id, type, aggregateId, payload, version, timestamp }) {
  return {
    event_id: id,
    event_type: type,
    aggregate_id: aggregateId,
    payload: payload ?? {},
    version,
    timestamp: timestamp ?? new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}
