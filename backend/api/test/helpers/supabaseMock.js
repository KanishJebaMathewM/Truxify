/**
 * In-memory Supabase query builder mock.
 *
 * The order + driver routes use a subset of the supabase-js surface:
 *
 *   supabase.from('orders').insert({...}).select('...').single()
 *   supabase.from('order_timeline').insert([...])
 *   supabase.from('load_offers').insert({...})
 *   supabase.from('orders').select('...').eq(...).maybeSingle()
 *   supabase.from('orders').select('...').order(...)
 *   supabase.rpc('accept_bid_tx', {...})
 *
 * This helper returns a fresh, chainable builder that records every call,
 * lets the test pre-load responses or assertions, and returns the recorded
 * payload on the final await.
 *
 * Tests use it via `vi.mock('../../src/config/db.js', () => ...)` to
 * swap the real supabase client out without touching the route code.
 *
 * No real Supabase / Postgres needed.
 */

class SupabaseQueryBuilder {
  /**
   * @param {object} options
   * @param {string} options.table - logical table name (orders, load_offers, ...)
   * @param {object} options.store - shared in-memory row store keyed by table
   * @param {object} options.programmed - per-test programmed responses
   *   (e.g. { nextInsertError: { message: 'duplicate key' } })
   * @param {Array} options.programmed.calls - shared log of every awaited call
   */
  constructor({ table, store, programmed, calls }) {
    this._table = table;
    this._store = store;
    this._programmed = programmed;
    this._calls = calls;
    this._mode = null;          // 'insert' | 'select' | 'rpc'
    this._payload = null;       // for insert / rpc
    this._select = '*';
    this._filters = [];         // [{col, op, val}]
    this._order = null;         // {col, ascending}
    this._limit = null;
    this._single = false;
    this._maybeSingle = false;
  }

  // ── Mutating verbs ──────────────────────────────────────────────
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
  upsert(payload, options) {
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
    this._mode = this._mode ?? 'select';
    this._select = columns;
    return this;
  }

  // ── Filter verbs (chainable, no-op except they record) ─────────
  eq(col, val)  { this._filters.push({ col, op: 'eq', val }); return this; }
  neq(col, val) { this._filters.push({ col, op: 'neq', val }); return this; }
  gt(col, val)  { this._filters.push({ col, op: 'gt', val }); return this; }
  gte(col, val) { this._filters.push({ col, op: 'gte', val }); return this; }
  lt(col, val)  { this._filters.push({ col, op: 'lt', val }); return this; }
  lte(col, val) { this._filters.push({ col, op: 'lte', val }); return this; }
  in(col, vals) { this._filters.push({ col, op: 'in', val: vals }); return this; }
  like(col, p)  { this._filters.push({ col, op: 'like', val: p }); return this; }
  ilike(col, p) { this._filters.push({ col, op: 'ilike', val: p }); return this; }
  is(col, val)  { this._filters.push({ col, op: 'is', val }); return this; }
  not(col, op, val) { this._filters.push({ col, op: `not:${op}`, val }); return this; }
  order(col, opts = {}) {
    this._order = { col, ascending: opts.ascending !== false };
    return this;
  }
  limit(n) { this._limit = n; return this; }
  range(from, to) { this._range = [from, to]; return this; }

  // ── Single-row terminators ────────────────────────────────────
  single()    { this._single = true;     return this._exec(); }
  maybeSingle() { this._maybeSingle = true; return this._exec(); }

  // ── await → execute ───────────────────────────────────────────
  then(resolve, reject) {
    return this._exec().then(resolve, reject);
  }
  catch(reject) { return this._exec().catch(reject); }

  _matches(row, f) {
    const v = row[f.col];
    let op = f.op;
    let negate = false;
    if (op.startsWith('not:')) {
      negate = true;
      op = op.substring(4);
    }
    let res = true;
    switch (op) {
      case 'eq':
      case 'is':
        res = v === f.val;
        break;
      case 'neq':
        res = v !== f.val;
        break;
      case 'gt':
        res = v > f.val;
        break;
      case 'gte':
        res = v >= f.val;
        break;
      case 'lt':
        res = v < f.val;
        break;
      case 'lte':
        res = v <= f.val;
        break;
      case 'ilike': {
        const valRegex = new RegExp(f.val.replace(/%/g, '.*'), 'i');
        res = valRegex.test(v);
        break;
      }
      case 'in': {
        if (typeof f.val === 'string') {
          const clean = f.val.replace(/^\s*\(\s*|\s*\)\s*$/g, '');
          const items = clean.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
          res = items.includes(v);
        } else if (Array.isArray(f.val)) {
          res = f.val.includes(v);
        } else {
          res = false;
        }
        break;
      }
      default:
        res = true;
        break;
    }
    return negate ? !res : res;
  }

  async _exec() {
    const callRecord = {
      table: this._table,
      mode: this._mode,
      payload: this._payload,
      select: this._select,
      filters: this._filters,
      order: this._order,
      limit: this._limit,
      single: this._single,
      maybeSingle: this._maybeSingle,
    };
    this._calls.push(callRecord);

    const matchingErrorIndex = this._programmed?.matchingErrors?.findIndex(item =>
      item.table === this._table && item.mode === this._mode
    ) ?? -1;
    if (matchingErrorIndex !== -1) {
      const [match] = this._programmed.matchingErrors.splice(matchingErrorIndex, 1);
      return { data: null, error: match.error };
    }

    // Programmed error path (e.g. simulate a supabase-side failure)
    if (this._programmed?.nextError) {
      const err = this._programmed.nextError;
      this._programmed.nextError = null;
      return { data: null, error: err };
    }
    // Programmed data path (e.g. simulate a specific row in .single())
    if (this._programmed?.nextData) {
      const data = this._programmed.nextData;
      this._programmed.nextData = null;
      return { data, error: null };
    }

    if (this._mode === 'upsert') {
      const rows = Array.isArray(this._payload) ? this._payload : [this._payload];
      if (!this._store[this._table]) {
        this._store[this._table] = [];
      }
      const onConflict = this._options?.onConflict;
      for (const row of rows) {
        let foundIdx = -1;
        if (onConflict) {
          foundIdx = this._store[this._table].findIndex(r => r[onConflict] === row[onConflict]);
        } else {
          const pkFields = ['id', 'user_id', 'event_id'];
          for (const pk of pkFields) {
            if (row[pk] !== undefined) {
              foundIdx = this._store[this._table].findIndex(r => r[pk] === row[pk]);
              if (foundIdx !== -1) break;
            }
          }
        }
        if (foundIdx !== -1) {
          this._store[this._table][foundIdx] = { ...this._store[this._table][foundIdx], ...row };
        } else {
          this._store[this._table].push(row);
        }
      }
      return { data: rows, error: null };
    }

    if (this._mode === 'insert') {
      const rows = Array.isArray(this._payload) ? this._payload : [this._payload];
      for (const row of rows) {
        this._store[this._table].push(row);
      }
      if (this._single) {
        // Return the inserted row (or a synthetic id+timestamp if missing)
        const row = { id: `mock-${this._table}-${this._store[this._table].length}`,
                      created_at: new Date().toISOString(),
                      ...rows[0] };
        return { data: row, error: null };
      }
      return { data: rows, error: null };
    }
    if (this._mode === 'update') {
      let rows = this._store[this._table] ?? [];
      let updatedRows = [];

      for (const row of rows) {
        const matches = this._filters.every(f => this._matches(row, f));

        if (matches) {
          Object.assign(row, this._payload);
          updatedRows.push(row);
        }
      }

      if (this._single) {
        return { data: updatedRows[0] ?? null, error: updatedRows[0] ? null : { code: 'PGRST116', message: 'no rows' } };
      }
      return { data: updatedRows, error: null };
    }

    if (this._mode === 'delete') {
      const rows = this._store[this._table] ?? [];
      const remaining = [];
      const deleted = [];
      for (const row of rows) {
        const matches = this._filters.every(f => this._matches(row, f));
        if (matches) {
          deleted.push(row);
        } else {
          remaining.push(row);
        }
      }
      this._store[this._table] = remaining;
      return { data: deleted, error: null };
    }

    if (this._mode === 'select' || this._mode === null) {
      let rows = (this._store[this._table] ?? []).slice();
      for (const f of this._filters) {
        rows = rows.filter(r => this._matches(r, f));
      }
      if (this._order) {
        const { col, ascending } = this._order;
        rows.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (ascending ? 1 : -1));
      }
      const totalCount = rows.length;
      if (this._range) {
        const [from, to] = this._range;
        rows = rows.slice(from, to + 1);
      }
      if (this._limit != null) rows = rows.slice(0, this._limit);
      if (this._single)     return { data: rows[0] ?? null, error: rows[0] ? null : { code: 'PGRST116', message: 'no rows' }, count: rows[0] ? 1 : 0 };
      if (this._maybeSingle) return { data: rows[0] ?? null, error: null, count: rows[0] ? 1 : 0 };
      return { data: rows, error: null, count: totalCount };
    }

    return { data: null, error: { message: `mock: unhandled mode ${this._mode}` } };
  }
}

/**
 * Build a fresh supabase mock for a single test.
 *
 * @returns {{
 *   supabase: object,   // mock with .from() / .rpc()
 *   store:    object,   // per-table in-memory row arrays
 *   calls:    Array,    // every awaited query, with payload
 *   programError: (msg: string) => void,
 *   programData:   (data: any)  => void,
 * }}
 */
export function createSupabaseMock(initialStore = {}) {
  const store = { ...initialStore };
  const calls = [];
  const programmed = {};
  const supabase = {
    from(table) {
      if (!(table in store)) store[table] = [];
      return new SupabaseQueryBuilder({ table, store, programmed, calls });
    },
    rpc(fnName, args) {
      calls.push({ rpc: fnName, args });
      if (programmed.nextRpcError) {
        const err = programmed.nextRpcError; programmed.nextRpcError = null;
        return Promise.resolve({ data: null, error: err });
      }
      if (programmed.nextError) {
        const err = programmed.nextError; programmed.nextError = null;
        return Promise.resolve({ data: null, error: err });
      }
      if (programmed.nextData) {
        const data = programmed.nextData; programmed.nextData = null;
        return Promise.resolve({ data, error: null });
      }
      // Simulate PL/pgSQL RPC side-effects that bump row versions
      if (fnName === 'accept_bid_tx' && args?.p_order_id) {
        const idx = store.orders?.findIndex(o => o.id === args.p_order_id);
        if (idx !== -1 && typeof store.orders[idx].version === 'number') {
          // Replace with a new object so the caller's reference retains the old version
          store.orders[idx] = { ...store.orders[idx], version: store.orders[idx].version + 1 };
        }
        if (args.p_load_id) {
          const offerIdx = store.load_offers?.findIndex(o => o.id === args.p_load_id);
          if (offerIdx !== -1) {
            store.load_offers[offerIdx] = { ...store.load_offers[offerIdx], status: 'claimed' };
          }
        }
        if (idx !== -1) {
          store.orders[idx] = { ...store.orders[idx], driver_id: args.p_driver_id, status: 'active' };
        }
      }
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, buffer, options) {
            calls.push({ storageUpload: { bucket, path, options } });
            if (programmed.nextStorageError) {
              const err = programmed.nextStorageError;
              programmed.nextStorageError = null;
              return { data: null, error: err };
            }
            if (!store.__storageObjects) store.__storageObjects = [];
            store.__storageObjects.push({ bucket, path, buffer, options });
            return { data: { path }, error: null };
          },
          async createSignedUrl(path, expiresIn) {
            calls.push({ storageSignedUrl: { bucket, path, expiresIn } });
            const signedUrl = `https://mock-storage.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=mock-token`;
            return { data: { signedUrl }, error: null };
          },
          async remove(paths) {
            calls.push({ storageRemove: { bucket, paths } });
            if (!store.__storageObjects) store.__storageObjects = [];
            const pathList = Array.isArray(paths) ? paths : [paths];
            store.__storageObjects = store.__storageObjects.filter(
              (o) => !(o.bucket === bucket && pathList.includes(o.path))
            );
            return { data: null, error: null };
          },
        };
      },
    },
  };
  return {
    supabase,
    store,
    calls,
    programError(msg = 'mock error')    { programmed.nextError    = { message: msg }; },
    programErrorFor(table, mode, msg = 'mock error') {
      programmed.matchingErrors ??= [];
      programmed.matchingErrors.push({ table, mode, error: { message: msg } });
    },
    programRpcError(msg = 'mock error') { programmed.nextRpcError = { message: msg }; },
    programStorageError(msg = 'mock error') { programmed.nextStorageError = { message: msg }; },
    programData(data)                   { programmed.nextData = data; },
  };
}
