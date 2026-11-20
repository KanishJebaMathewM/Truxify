
/**
 * In-memory Supabase query builder mock.
 *
 * Supports:
 * - insert, select, update, upsert, delete
 * - eq, neq, gt, gte, lt, lte, in, like, ilike, is, not, or
 * - order, limit, range, single, maybeSingle
 * - RPC simulations for orders, device tokens, and maintenance photos
 * - Storage upload, signed URLs, and removal
 * - Programmed errors and responses for Vitest
 */

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneValue(item),
      ])
    );
  }

  return value;
}

class SupabaseQueryBuilder {
  constructor({ table, store, programmed, calls }) {
    this._table = table;
    this._store = store;
    this._programmed = programmed;
    this._calls = calls;

    this._mode = null;
    this._payload = null;
    this._select = '*';
    this._filters = [];
    this._order = null;
    this._orders = [];
    this._limit = null;
    this._range = null;
    this._single = false;
    this._maybeSingle = false;
    this._options = null;
    this._executed = null;
  }

  // ---------------------------------------------------------------
  // Query methods
  // ---------------------------------------------------------------

  insert(payload) {
    this._mode = 'insert';
    this._payload = payload;
    return this;
  }

  update(payload) {
    this._mode = 'update';
    this._payload = payload;
    return this;
  }

  upsert(payload, options = {}) {
    this._mode = 'upsert';
    this._payload = payload;
    this._options = options;
    return this;
  }

  delete() {
    this._mode = 'delete';
    return this;
  }

  select(columns = '*') {
    if (this._mode === null) {
      this._mode = 'select';
    }

    this._select = columns;
    return this;
  }

  // ---------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------

  eq(col, val) {
    this._filters.push({ col, op: 'eq', val });
    return this;
  }

  neq(col, val) {
    this._filters.push({ col, op: 'neq', val });
    return this;
  }

  gt(col, val) {
    this._filters.push({ col, op: 'gt', val });
    return this;
  }

  gte(col, val) {
    this._filters.push({ col, op: 'gte', val });
    return this;
  }

  lt(col, val) {
    this._filters.push({ col, op: 'lt', val });
    return this;
  }

  lte(col, val) {
    this._filters.push({ col, op: 'lte', val });
    return this;
  }

  in(col, vals) {
    this._filters.push({ col, op: 'in', val: vals });
    return this;
  }

  like(col, pattern) {
    this._filters.push({ col, op: 'like', val: pattern });
    return this;
  }

  ilike(col, pattern) {
    this._filters.push({ col, op: 'ilike', val: pattern });
    return this;
  }

  is(col, val) {
    this._filters.push({ col, op: 'is', val });
    return this;
  }

  not(col, op, val) {
    this._filters.push({
      col,
      op: `not:${op}`,
      val,
    });
    return this;
  }

  or(spec) {
    this._filters.push({
      col: null,
      op: 'or',
      val: spec,
    });
    return this;
  }

  order(col, opts = {}) {
    const entry = {
      col,
      ascending: opts.ascending !== false,
    };

    this._orders.push(entry);
    this._order = entry;

    return this;
  }

  limit(n) {
    this._limit = n;
    return this;
  }

  range(from, to) {
    this._range = [from, to];
    return this;
  }

  // ---------------------------------------------------------------
  // Single-row terminators
  // ---------------------------------------------------------------

  single() {
    this._single = true;
    return this._exec();
  }

  maybeSingle() {
    this._maybeSingle = true;
    return this._exec();
  }

  // ---------------------------------------------------------------
  // Thenable support: await supabase.from(...).select(...)
  // ---------------------------------------------------------------

  then(resolve, reject) {
    return this._exec().then(resolve, reject);
  }

  catch(reject) {
    return this._exec().catch(reject);
  }

  finally(callback) {
    return this._exec().finally(callback);
  }

  // ---------------------------------------------------------------
  // PostgREST OR parsing
  // ---------------------------------------------------------------

  _splitOr(spec) {
    const parts = [];
    let depth = 0;
    let current = '';
    let quoted = false;
    let escaped = false;

    for (const ch of String(spec)) {
      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        current += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        quoted = !quoted;
      }

      if (!quoted) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;

        if (ch === ',' && depth === 0) {
          parts.push(current.trim());
          current = '';
          continue;
        }
      }

      current += ch;
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }

  _parseCond(cond) {
    let opPrefix = '';
    let rest = String(cond).trim();

    if (rest.startsWith('not.')) {
      opPrefix = 'not:';
      rest = rest.substring(4);
    }

    const firstDot = rest.indexOf('.');
    const secondDot = rest.indexOf('.', firstDot + 1);

    if (firstDot === -1 || secondDot === -1) {
      return {
        col: null,
        op: 'invalid',
        val: rest,
      };
    }

    const col = rest.slice(0, firstDot);
    const op = rest.slice(firstDot + 1, secondDot);
    let val = rest.slice(secondDot + 1);

    if (op === 'is') {
      if (val === 'null') val = null;
      if (val === 'true') val = true;
      if (val === 'false') val = false;
    }

    // Handle quoted values in simple PostgREST expressions.
    if (
      val.length >= 2 &&
      val.startsWith('"') &&
      val.endsWith('"')
    ) {
      val = val.slice(1, -1);
    }

    return {
      col,
      op: opPrefix + op,
      val,
    };
  }

  // ---------------------------------------------------------------
  // LIKE / ILIKE helper
  // ---------------------------------------------------------------

  _likeMatches(value, pattern, caseInsensitive = false) {
    if (value == null || pattern == null) {
      return false;
    }

    // Convert SQL wildcards to regular-expression wildcards.
    // Escape all other regular-expression characters first.
    const escaped = String(pattern)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '.*')
      .replace(/_/g, '.');

    const flags = caseInsensitive ? 'i' : '';

    return new RegExp(`^${escaped}$`, flags)
      .test(String(value));
  }

  // ---------------------------------------------------------------
  // Filter evaluation
  // ---------------------------------------------------------------

  _matches(row, filter) {
    if (!row) return false;

    if (filter.op === 'or') {
      const conditions = this._splitOr(String(filter.val));

      return conditions.some(condition => {
        const trimmed = condition.trim();

        if (
          trimmed.startsWith('and(') &&
          trimmed.endsWith(')')
        ) {
          return this._splitOr(
            trimmed.slice(4, -1)
          ).every(part =>
            this._matches(row, this._parseCond(part))
          );
        }

        return this._matches(
          row,
          this._parseCond(trimmed)
        );
      });
    }

    if (filter.op === 'invalid' || filter.col == null) {
      return false;
    }

    const value = row[filter.col];

    let op = filter.op;
    let negate = false;

    if (op.startsWith('not:')) {
      negate = true;
      op = op.substring(4);
    }

    let matched = false;

    switch (op) {
      case 'eq':
        matched = value === filter.val;
        break;

      case 'neq':
        matched = value !== filter.val;
        break;

      case 'is':
        matched =
          filter.val === null
            ? value == null
            : value === filter.val;
        break;

      case 'gt':
        matched = value > filter.val;
        break;

      case 'gte':
        matched = value >= filter.val;
        break;

      case 'lt':
        matched = value < filter.val;
        break;

      case 'lte':
        matched = value <= filter.val;
        break;

      case 'like':
        matched = this._likeMatches(value, filter.val);
        break;

      case 'ilike':
        matched = this._likeMatches(
          value,
          filter.val,
          true
        );
        break;

      case 'in': {
        let values = filter.val;

        if (typeof values === 'string') {
          const clean = values.replace(
            /^\s*\(\s*|\s*\)\s*$/g,
            ''
          );

          values = clean
            ? clean.split(',').map(item =>
                item.trim().replace(/^["']|["']$/g, '')
              )
            : [];
        }

        if (Array.isArray(values)) {
          matched = values.some(item => item === value);

          // Accommodate numeric IDs represented as strings.
          if (
            !matched &&
            value != null &&
            values.some(item =>
              String(item) === String(value)
            )
          ) {
            matched = true;
          }
        }

        break;
      }

      default:
        // Unsupported filters should not silently match every row.
        matched = false;
        break;
    }

    return negate ? !matched : matched;
  }

  // ---------------------------------------------------------------
  // Programmed responses
  // ---------------------------------------------------------------

  _hasProgrammedValue(key) {
    return Object.prototype.hasOwnProperty.call(
      this._programmed,
      key
    );
  }

  _consumeProgrammedValue(key) {
    const value = this._programmed[key];
    delete this._programmed[key];
    return value;
  }

  _getMatchingError() {
    const errors = this._programmed.matchingErrors;

    if (!Array.isArray(errors)) {
      return null;
    }

    const index = errors.findIndex(
      item =>
        item.table === this._table &&
        item.mode === this._mode
    );

    if (index === -1) {
      return null;
    }

    return errors.splice(index, 1)[0];
  }

  // ---------------------------------------------------------------
  // Execute the query
  // ---------------------------------------------------------------

  async _exec() {
    // Prevent duplicate execution when a query is awaited more than once.
    if (this._executed) {
      return this._executed;
    }

    this._executed = this._executeQuery();

    return this._executed;
  }

  async _executeQuery() {
    const callRecord = {
      table: this._table,
      mode: this._mode,
      payload: cloneValue(this._payload),
      select: this._select,
      filters: cloneValue(this._filters),
      order: this._order
        ? { ...this._order }
        : null,
      orders: cloneValue(this._orders),
      limit: this._limit,
      range: this._range
        ? [...this._range]
        : null,
      single: this._single,
      maybeSingle: this._maybeSingle,
    };

    this._calls.push(callRecord);

    // Per-table and per-mode programmed errors.
    const matchingError = this._getMatchingError();

    if (matchingError) {
      return {
        data: null,
        error: matchingError.error,
      };
    }

    // Generic programmed error.
    if (this._hasProgrammedValue('nextError')) {
      const error = this._consumeProgrammedValue(
        'nextError'
      );

      return {
        data: null,
        error,
      };
    }

    // Programmed response data, including null, false, or 0.
    if (this._hasProgrammedValue('nextData')) {
      const data = this._consumeProgrammedValue(
        'nextData'
      );

      return {
        data,
        error: null,
      };
    }

    if (!Array.isArray(this._store[this._table])) {
      this._store[this._table] = [];
    }

    // -------------------------------------------------------------
    // UPSERT
    // -------------------------------------------------------------

    if (this._mode === 'upsert') {
      const inputRows = Array.isArray(this._payload)
        ? this._payload
        : [this._payload];

      const resultRows = [];

      for (const input of inputRows) {
        if (!input || typeof input !== 'object') {
          return {
            data: null,
            error: {
              message: 'upsert payload must contain objects',
            },
          };
        }

        const row = cloneValue(input);
        let foundIdx = -1;

        const conflictFields = this._options?.onConflict
          ? String(this._options.onConflict)
              .split(',')
              .map(field => field.trim())
          : ['id', 'user_id', 'event_id'];

        for (const field of conflictFields) {
          if (row[field] === undefined) continue;

          foundIdx = this._store[this._table].findIndex(
            existing =>
              existing[field] === row[field]
          );

          if (foundIdx !== -1) break;
        }

        if (foundIdx !== -1) {
          this._store[this._table][foundIdx] = {
            ...this._store[this._table][foundIdx],
            ...row,
          };

          resultRows.push(
            this._store[this._table][foundIdx]
          );
        } else {
          this._store[this._table].push(row);
          resultRows.push(row);
        }
      }

      return {
        data: resultRows,
        error: null,
      };
    }

    // -------------------------------------------------------------
    // INSERT
    // -------------------------------------------------------------

    if (this._mode === 'insert') {
      const inputRows = Array.isArray(this._payload)
        ? this._payload
        : [this._payload];

      const insertedRows = [];

      for (const input of inputRows) {
        if (!input || typeof input !== 'object') {
          return {
            data: null,
            error: {
              message: 'insert payload must contain objects',
            },
          };
        }

        const row = cloneValue(input);

        if (row.id == null) {
          row.id =
            `mock-${this._table}-` +
            (this._store[this._table].length + 1);
        }

        if (row.created_at == null) {
          row.created_at = new Date().toISOString();
        }

        this._store[this._table].push(row);
        insertedRows.push(row);
      }

      if (this._single) {
        return {
          data: insertedRows[0] ?? null,
          error: insertedRows[0]
            ? null
            : {
                code: 'PGRST116',
                message: 'no rows',
              },
        };
      }

      if (this._maybeSingle) {
        return {
          data: insertedRows[0] ?? null,
          error: null,
        };
      }

      return {
        data: insertedRows,
        error: null,
      };
    }

    // -------------------------------------------------------------
    // UPDATE
    // -------------------------------------------------------------

    if (this._mode === 'update') {
      const updatedRows = [];

      for (const row of this._store[this._table]) {
        const matches = this._filters.every(filter =>
          this._matches(row, filter)
        );

        if (matches) {
          Object.assign(row, cloneValue(this._payload));
          updatedRows.push(row);
        }
      }

      if (this._single) {
        return {
          data: updatedRows[0] ?? null,
          error: updatedRows[0]
            ? null
            : {
                code: 'PGRST116',
                message: 'no rows',
              },
        };
      }

      if (this._maybeSingle) {
        return {
          data: updatedRows[0] ?? null,
          error: null,
        };
      }

      return {
        data: updatedRows,
        error: null,
      };
    }

    // -------------------------------------------------------------
    // DELETE
    // -------------------------------------------------------------

    if (this._mode === 'delete') {
      const remaining = [];
      const deleted = [];

      for (const row of this._store[this._table]) {
        const matches = this._filters.every(filter =>
          this._matches(row, filter)
        );

        if (matches) {
          deleted.push(row);
        } else {
          remaining.push(row);
        }
      }

      this._store[this._table] = remaining;

      return {
        data: deleted,
        error: null,
        count: deleted.length,
      };
    }

    // -------------------------------------------------------------
    // SELECT
    // -------------------------------------------------------------

    if (this._mode === 'select' || this._mode === null) {
      let rows = this._store[this._table].slice();

      for (const filter of this._filters) {
        rows = rows.filter(row =>
          this._matches(row, filter)
        );
      }

      if (this._orders.length > 0) {
        rows.sort((a, b) => {
          for (const { col, ascending } of this._orders) {
            if (a[col] === b[col]) continue;

            // Keep nullish values deterministic.
            if (a[col] == null) {
              return ascending ? -1 : 1;
            }

            if (b[col] == null) {
              return ascending ? 1 : -1;
            }

            const comparison = a[col] > b[col] ? 1 : -1;

            return ascending
              ? comparison
              : -comparison;
          }

          return 0;
        });
      }

      const totalCount = rows.length;

      if (this._range) {
        const [from, to] = this._range;
        rows = rows.slice(from, to + 1);
      }

      if (this._limit != null) {
        rows = rows.slice(0, this._limit);
      }

      if (this._single) {
        const row = rows[0] ?? null;

        return {
          data: row,
          error: row
            ? null
            : {
                code: 'PGRST116',
                message: 'no rows',
              },
          count: row ? 1 : 0,
        };
      }

      if (this._maybeSingle) {
        return {
          data: rows[0] ?? null,
          error: null,
          count: rows[0] ? 1 : 0,
        };
      }

      return {
        data: rows,
        error: null,
        count: totalCount,
      };
    }

    return {
      data: null,
      error: {
        message: `mock: unhandled mode ${this._mode}`,
      },
    };
  }
}

// =================================================================
// CREATE SUPABASE MOCK
// =================================================================

export function createSupabaseMock(initialStore = {}) {
  const initialSnapshot = cloneValue(initialStore);
  const store = cloneValue(initialSnapshot);
  const calls = [];
  const programmed = {};

  const supabase = {
    from(table) {
      if (!Array.isArray(store[table])) {
        store[table] = [];
      }

      return new SupabaseQueryBuilder({
        table,
        store,
        programmed,
        calls,
      });
    },

    // -------------------------------------------------------------
    // RPC
    // -------------------------------------------------------------

    rpc(fnName, args = {}) {
      calls.push({
        rpc: fnName,
        args: cloneValue(args),
      });

      if (programmed.nextRpcError) {
        const error = programmed.nextRpcError;
        programmed.nextRpcError = null;

        return Promise.resolve({
          data: null,
          error,
        });
      }

      if (
        Object.prototype.hasOwnProperty.call(
          programmed,
          'nextError'
        )
      ) {
        const error = programmed.nextError;
        delete programmed.nextError;

        return Promise.resolve({
          data: null,
          error,
        });
      }

      if (
        Object.prototype.hasOwnProperty.call(
          programmed,
          'nextData'
        )
      ) {
        const data = programmed.nextData;
        delete programmed.nextData;

        return Promise.resolve({
          data,
          error: null,
        });
      }

      // -----------------------------------------------------------
      // accept_bid_tx
      // -----------------------------------------------------------

      if (
        fnName === 'accept_bid_tx' &&
        args.p_order_id
      ) {
        const orders = store.orders ?? [];
        const offers = store.load_offers ?? [];

        const orderIdx = orders.findIndex(
          order => order.id === args.p_order_id
        );

        if (orderIdx === -1) {
          return Promise.resolve({
            data: null,
            error: null,
          });
        }

        const currentOrder = orders[orderIdx];

        const updatedOrder = {
          ...currentOrder,
          driver_id: args.p_driver_id,
          status: 'active',
        };

        if (typeof currentOrder.version === 'number') {
          updatedOrder.version = currentOrder.version + 1;
        }

        store.orders[orderIdx] = updatedOrder;

        if (args.p_load_id) {
          const offerIdx = offers.findIndex(
            offer => offer.id === args.p_load_id
          );

          if (offerIdx !== -1) {
            store.load_offers[offerIdx] = {
              ...offers[offerIdx],
              status: 'claimed',
            };
          }
        }

        return Promise.resolve({
          data: updatedOrder,
          error: null,
        });
      }

      // -----------------------------------------------------------
      // register_device_token
      // -----------------------------------------------------------

      if (fnName === 'register_device_token') {
        const now = new Date().toISOString();
        const userId = args.p_user_id;
        const token = args.p_fcm_token;
        const deviceId = args.p_device_id ?? null;

        store.user_devices ??= [];
        store.profiles ??= [];

        // Retire the previous token for this user and device.
        if (deviceId) {
          for (const row of store.user_devices) {
            if (
              row.device_id === deviceId &&
              row.user_id === userId &&
              row.fcm_token !== token &&
              row.is_active !== false
            ) {
              row.is_active = false;
              row.deactivated_at = now;
              row.updated_at = now;
            }
          }
        }

        // Idempotent registration by token.
        let row = store.user_devices.find(
          device => device.fcm_token === token
        );

        if (!row) {
          row = {
            id: `device-${store.user_devices.length + 1}`,
          };

          store.user_devices.push(row);
        }

        Object.assign(row, {
          user_id: userId,
          fcm_token: token,
          platform: args.p_platform ?? 'android',
          device_id: deviceId,
          metadata: args.p_metadata ?? null,
          is_active: true,
          deactivated_at: null,
          last_seen: args.p_last_seen ?? now,
          created_at: row.created_at ?? now,
          updated_at: now,
        });

        // Clear the previous user's profile fallback.
        if (
          args.p_prev_user_id &&
          args.p_prev_user_id !== userId
        ) {
          const previousProfile = store.profiles.find(
            profile => profile.id === args.p_prev_user_id
          );

          if (previousProfile) {
            previousProfile.fcm_token = null;
            previousProfile.fcm_token_updated_at = now;
          }
        }

        // Update the registering user's fallback token.
        const profile = store.profiles.find(
          item => item.id === userId
        );

        if (profile) {
          profile.fcm_token = token;
          profile.fcm_token_updated_at = now;
        }

        return Promise.resolve({
          data: row,
          error: null,
        });
      }

      // -----------------------------------------------------------
      // unregister_device_token
      // -----------------------------------------------------------

      if (fnName === 'unregister_device_token') {
        const now = new Date().toISOString();
        const userId = args.p_user_id;
        const token = args.p_fcm_token;

        store.user_devices ??= [];
        store.profiles ??= [];

        const row = store.user_devices.find(
          device =>
            device.fcm_token === token &&
            device.user_id === userId
        );

        let deletedCount = 0;

        if (row) {
          row.is_active = false;
          row.deactivated_at = now;
          row.updated_at = now;
          deletedCount = 1;
        }

        const nextActive = store.user_devices.find(
          device =>
            device.user_id === userId &&
            device.is_active !== false &&
            device.fcm_token !== token
        );

        const profile = store.profiles.find(
          item => item.id === userId
        );

        if (profile && profile.fcm_token === token) {
          profile.fcm_token = nextActive?.fcm_token ?? null;
          profile.fcm_token_updated_at = now;
        }

        return Promise.resolve({
          data: deletedCount,
          error: null,
        });
      }

      // -----------------------------------------------------------
      // append_maintenance_photos
      // -----------------------------------------------------------

      if (
        fnName === 'append_maintenance_photos' &&
        args.p_ticket_id
      ) {
        store.truck_maintenance_tickets ??= [];

        const idx = store.truck_maintenance_tickets.findIndex(
          ticket => ticket.id === args.p_ticket_id
        );

        if (idx !== -1) {
          const ticket = store.truck_maintenance_tickets[idx];

          store.truck_maintenance_tickets[idx] = {
            ...ticket,
            photo_urls: [
              ...(ticket.photo_urls ?? []),
              ...(args.p_new_paths ?? []),
            ],
          };

          return Promise.resolve({
            data: store.truck_maintenance_tickets[idx],
            error: null,
          });
        }

        return Promise.resolve({
          data: null,
          error: null,
        });
      }

      // -----------------------------------------------------------
      // update_order_status_tx
      // -----------------------------------------------------------

      if (
        fnName === 'update_order_status_tx' &&
        args.p_order_id
      ) {
        const orders = store.orders ?? [];

        const idx = orders.findIndex(
          order => order.id === args.p_order_id
        );

        if (idx === -1) {
          return Promise.resolve({
            data: [],
            error: null,
          });
        }

        const current = orders[idx];

        // Match the status transition guards.
        if (
          args.p_not_statuses &&
          args.p_not_statuses.includes(current.status)
        ) {
          return Promise.resolve({
            data: [],
            error: null,
          });
        }

        if (
          args.p_escrow_in_statuses &&
          (
            current.escrow_status == null ||
            !args.p_escrow_in_statuses.includes(
              current.escrow_status
            )
          )
        ) {
          return Promise.resolve({
            data: [],
            error: null,
          });
        }

        const updated = {
          ...current,
          status: args.p_status,
          updated_at: new Date().toISOString(),
          version: (current.version ?? 0) + 1,

          ...(args.p_cancellation_reason != null && {
            cancellation_reason: args.p_cancellation_reason,
          }),

          ...(args.p_cancellation_fee != null && {
            cancellation_fee: args.p_cancellation_fee,
          }),

          ...(args.p_escrow_status != null && {
            escrow_status: args.p_escrow_status,
          }),

          ...(args.p_escrow_refund_attempts != null && {
            escrow_refund_attempts:
              args.p_escrow_refund_attempts,
          }),

          ...(args.p_refund_tx_hash != null && {
            refund_tx_hash: args.p_refund_tx_hash,
          }),

          ...(args.p_escrow_refund_last_attempt_at != null && {
            escrow_refund_last_attempt_at:
              args.p_escrow_refund_last_attempt_at,
          }),

          ...(args.p_escrow_refunded_at != null && {
            escrow_refunded_at:
              args.p_escrow_refunded_at,
          }),

          ...(args.p_escrow_refund_submitted_at != null && {
            escrow_refund_submitted_at:
              args.p_escrow_refund_submitted_at,
          }),

          escrow_refund_error:
            args.p_clear_escrow_refund_error
              ? null
              : (
                  args.p_escrow_refund_error ??
                  current.escrow_refund_error ??
                  null
                ),
        };

        store.orders[idx] = updated;

        return Promise.resolve({
          data: [updated],
          error: null,
        });
      }

      // -----------------------------------------------------------
      // create_order_tx
      // -----------------------------------------------------------

      if (
        fnName === 'create_order_tx' &&
        args.p_order_display_id
      ) {
        store.orders ??= [];
        store.order_timeline ??= [];
        store.load_offers ??= [];

        const now = new Date().toISOString();

        const order = {
          id: `mock-order-${store.orders.length + 1}`,
          order_display_id: args.p_order_display_id,
          customer_id: args.p_customer_id,
          status: 'pending',
          created_at: now,
          updated_at: now,

          pickup_address: args.p_pickup_address,
          pickup_lat: args.p_pickup_lat,
          pickup_lng: args.p_pickup_lng,

          drop_address: args.p_drop_address,
          drop_lat: args.p_drop_lat,
          drop_lng: args.p_drop_lng,

          pickup_date: args.p_pickup_date,
          pickup_time: args.p_pickup_time,

          goods_type: args.p_goods_type,
          weight_tonnes: args.p_weight_tonnes,
          is_stackable: args.p_is_stackable,
          is_fragile: args.p_is_fragile,
          special_requirements: args.p_special_requirements,

          base_freight: args.p_base_freight,
          toll_estimate: args.p_toll_estimate,
          platform_fee: args.p_platform_fee,
          total_amount: args.p_total_amount,
          estimated_price: args.p_estimated_price,
        };

        store.orders.push(order);

        const milestones = [
          ['Order Placed', true, 10],
          ['Truck Assigned', false, 20],
          ['En Route to Pickup', false, 30],
          ['Arrived at Pickup', false, 35],
          ['Goods Loaded', false, 40],
          ['In Transit', false, 50],
          ['Arriving', false, 55],
          ['Delivered', false, 60],
        ];

        for (const [
          milestone,
          completed,
          sort_order,
        ] of milestones) {
          store.order_timeline.push({
            order_display_id: args.p_order_display_id,
            milestone,
            milestone_time: completed ? now : null,
            completed,
            sort_order,
          });
        }

        store.load_offers.push({
          order_display_id: args.p_order_display_id,
          customer_id: args.p_customer_id,
          customer_name: args.p_customer_name,
          pickup_address: args.p_pickup_address,
          drop_address: args.p_drop_address,
          goods_type: args.p_goods_type,
          freight_value: args.p_total_amount,
          status: 'available',
        });

        return Promise.resolve({
          data: order,
          error: null,
        });
      }

      // -----------------------------------------------------------
      // update_order_and_load_offer
      // -----------------------------------------------------------

      if (
        fnName === 'update_order_and_load_offer' &&
        args.p_order_id
      ) {
        store.orders ??= [];
        store.load_offers ??= [];

        const orderIdx = store.orders.findIndex(
          order => order.id === args.p_order_id
        );

        if (orderIdx === -1) {
          return Promise.resolve({
            data: null,
            error: {
              message: 'Order not found',
            },
          });
        }

        store.orders[orderIdx] = {
          ...store.orders[orderIdx],
          ...(args.p_order_updates ?? {}),
        };

        const offerIdx = store.load_offers.findIndex(
          offer =>
            offer.order_display_id ===
            args.p_order_display_id
        );

        if (offerIdx !== -1) {
          store.load_offers[offerIdx] = {
            ...store.load_offers[offerIdx],
            ...(args.p_offer_updates ?? {}),
          };
        }

        return Promise.resolve({
          data: store.orders[orderIdx],
          error: null,
        });
      }

      // Default response for unimplemented RPC functions.
      return Promise.resolve({
        data: null,
        error: null,
      });
    },

    // -------------------------------------------------------------
    // Supabase Storage mock
    // -------------------------------------------------------------

    storage: {
      from(bucket) {
        return {
          async upload(path, buffer, options = {}) {
            calls.push({
              storageUpload: {
                bucket,
                path,
                options: cloneValue(options),
              },
            });

            if (programmed.nextStorageError) {
              const error = programmed.nextStorageError;
              programmed.nextStorageError = null;

              return {
                data: null,
                error,
              };
            }

            store.__storageObjects ??= [];

            store.__storageObjects.push({
              bucket,
              path,
              buffer,
              options: cloneValue(options),
            });

            return {
              data: { path },
              error: null,
            };
          },

          async createSignedUrl(path, expiresIn) {
            calls.push({
              storageSignedUrl: {
                bucket,
                path,
                expiresIn,
              },
            });

            const signedUrl =
              'https://mock-storage.supabase.co/storage/v1/' +
              `object/sign/${bucket}/${path}?token=mock-token`;

            return {
              data: { signedUrl },
              error: null,
            };
          },

          async remove(paths) {
            calls.push({
              storageRemove: {
                bucket,
                paths: cloneValue(paths),
              },
            });

            store.__storageObjects ??= [];

            const pathList = Array.isArray(paths)
              ? paths
              : [paths];

            const removed = store.__storageObjects.filter(
              object =>
                object.bucket === bucket &&
                pathList.includes(object.path)
            );

            store.__storageObjects =
              store.__storageObjects.filter(
                object =>
                  !(
                    object.bucket === bucket &&
                    pathList.includes(object.path)
                  )
              );

            return {
              data: removed.map(object => ({
                name: object.path,
              })),
              error: null,
            };
          },
        };
      },
    },
  };

  // ---------------------------------------------------------------
  // Public helpers for tests
  // ---------------------------------------------------------------

  return {
    supabase,
    store,
    calls,

    reset() {
      for (const key of Object.keys(store)) {
        delete store[key];
      }

      Object.assign(store, cloneValue(initialSnapshot));

      calls.length = 0;

      for (const key of Object.keys(programmed)) {
        delete programmed[key];
      }
    },

    programError(msg = 'mock error') {
      programmed.nextError = {
        message: msg,
      };
    },

    programErrorFor(
      table,
      mode,
      msg = 'mock error'
    ) {
      programmed.matchingErrors ??= [];

      programmed.matchingErrors.push({
        table,
        mode,
        error: {
          message: msg,
        },
      });
    },

    programRpcError(msg = 'mock error') {
      programmed.nextRpcError = {
        message: msg,
      };
    },

    programStorageError(msg = 'mock error') {
      programmed.nextStorageError = {
        message: msg,
      };
    },

    programData(data) {
      programmed.nextData = data;
    },
  };
}
