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
  upsert(payload) {
    this._mode = 'upsert';
    this._payload = payload;
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

  for (const row of rows) {
    const matches = this._filters.every(f => {
      const v = row[f.col];

      switch (f.op) {
        case 'eq':
          return v === f.val;
        default:
          return true;
      }
    });

    if (matches) {
      Object.assign(row, this._payload);
    }
  }

  return { data: rows, error: null };
}

    if (this._mode === 'select' || this._mode === null) {
      let rows = (this._store[this._table] ?? []).slice();
      for (const f of this._filters) {
        rows = rows.filter(r => {
          const v = r[f.col];
          switch (f.op) {
            case 'eq':  return v === f.val;
            case 'neq': return v !== f.val;
            case 'gt':  return v >  f.val;
            case 'gte': return v >= f.val;
            case 'lt':  return v <  f.val;
            case 'lte': return v <= f.val;
            case 'in':  return f.val.includes(v);
            case 'is':  return v === f.val;
            default:    return true;
          }
        });
      }
      if (this._order) {
        const { col, ascending } = this._order;
        rows.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (ascending ? 1 : -1));
      }
      if (this._limit != null) rows = rows.slice(0, this._limit);
      if (this._single)     return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } };
      if (this._maybeSingle) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
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
      if (programmed.nextError) {
        const err = programmed.nextError; programmed.nextError = null;
        return Promise.resolve({ data: null, error: err });
      }
      if (programmed.nextData) {
        const data = programmed.nextData; programmed.nextData = null;
        return Promise.resolve({ data, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return {
    supabase,
    store,
    calls,
    programError(msg = 'mock error') { programmed.nextError = { message: msg }; },
    programData(data)                { programmed.nextData = data; },
  };
}
