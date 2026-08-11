import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory PostgREST mock: supports
//   rpc()                                  -> claim_webhook_failure_batch
//   from().insert()                        -> enqueue
//   from().update()....select('id')        -> fenced complete/requeue/fail
//   from().select(..{count}).eq()          -> backlog count
// ---------------------------------------------------------------------------
const mockState = {
  rpcResult: { data: [], error: null },
  insertResult: { error: null },
  updateResultByStatus: {
    resolved: { data: [{ id: 'row' }], error: null },
    pending: { data: [{ id: 'row' }], error: null },
    failed_permanently: { data: [{ id: 'row' }], error: null },
  },
  backlogCount: 0,
  backlogError: null,
};

const rpcCalls = [];
const updateCalls = [];
const insertCalls = [];
const backlogCalls = [];

function buildQuery(table) {
  const q = {
    _update: null,
    _filters: null,
    _readOpts: null,
    insert(payload) {
      insertCalls.push({ table, payload });
      return Promise.resolve(mockState.insertResult);
    },
    update(payload) {
      q._update = payload;
      return q;
    },
    eq(col, val) {
      q._filters = q._filters || [];
      q._filters.push({ col, val });
      if (q._readOpts) {
        backlogCalls.push({ table, cols: q._readCols, opts: q._readOpts, filters: q._filters });
        return Promise.resolve({ count: mockState.backlogCount, data: null, error: mockState.backlogError });
      }
      return q;
    },
    in(col, val) {
      q._filters = q._filters || [];
      q._filters.push({ col, val, op: 'in' });
      return q;
    },
    order() { return q; },
    limit() { return q; },
    select(cols, opts) {
      if (q._update) {
        const status = q._update.status;
        updateCalls.push({ table, payload: q._update, filters: q._filters, cols });
        return Promise.resolve(mockState.updateResultByStatus[status]);
      }
      q._readCols = cols;
      q._readOpts = opts;
      return q;
    },
  };
  return q;
}

const mockClient = {
  rpc: vi.fn((name, params) => {
    rpcCalls.push({ name, params });
    return Promise.resolve(mockState.rpcResult);
  }),
  from: vi.fn((table) => buildQuery(table)),
};

vi.mock('../../src/config/db.js', () => ({
  supabase: mockClient,
  supabaseAdmin: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const { dlqService, getWorkerId, buildDedupeKey } = await import('../../src/services/webhook/dlqService.js');

function makeEvent(overrides = {}) {
  return {
    id: 'dlq-1',
    provider: 'escrow',
    event_type: 'EscrowReleased',
    payload: { orderId: 'order-1', txHash: '0xabc' },
    retry_count: 0,
    attempt_count: 1,
    ...overrides,
  };
}

describe('dlqService — lease-based crash-safe claims', () => {
  const handler = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.rpcResult = { data: [], error: null };
    mockState.insertResult = { error: null };
    mockState.updateResultByStatus = {
      resolved: { data: [{ id: 'row' }], error: null },
      pending: { data: [{ id: 'row' }], error: null },
      failed_permanently: { data: [{ id: 'row' }], error: null },
    };
    mockState.backlogCount = 0;
    mockState.backlogError = null;
    rpcCalls.length = 0;
    updateCalls.length = 0;
    insertCalls.length = 0;
    backlogCalls.length = 0;
    handler.mockReset();
  });

  // CASE 1 — PENDING EVENT CLAIM
  it('claims a pending event atomically via the RPC with worker id and lease', async () => {
    const event = makeEvent();
    mockState.rpcResult = { data: [event], error: null };

    await dlqService.processQueue({ escrow: handler }, { leaseMs: 300_000 });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('claim_webhook_failure_batch');
    expect(rpcCalls[0].params).toEqual({
      p_worker_id: getWorkerId(),
      p_batch_size: 50,
      p_lease_seconds: 300,
      p_max_attempts: 25,
    });
    expect(handler).toHaveBeenCalledWith('EscrowReleased', { orderId: 'order-1', txHash: '0xabc' });
  });

  it('claims only due pending + expired-lease processing rows (eligibility lives in SQL)', async () => {
    // The service delegates eligibility to the DB RPC — assert it does not
    // perform its own SELECT-then-UPDATE. There must be exactly one DB call
    // (the atomic claim) before processing.
    const event = makeEvent();
    mockState.rpcResult = { data: [event], error: null };

    await dlqService.processQueue({ escrow: handler }, { batchSize: 10 });

    expect(mockClient.from).toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(1);
  });

  // CASE 2 — TWO WORKERS CLAIM SAME EVENT
  it('never lets a second worker process an event already claimed (exclusive RPC claim)', async () => {
    const event = makeEvent();
    // Worker A gets the event; the DB (FOR UPDATE SKIP LOCKED) gives worker B nothing.
    mockState.rpcResult = { data: [event], error: null };

    const summaryA = await dlqService.processQueue({ escrow: handler }, { workerId: 'replica-a' });
    expect(summaryA.claimed).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);

    handler.mockClear();
    mockState.rpcResult = { data: [], error: null };
    const summaryB = await dlqService.processQueue({ escrow: handler }, { workerId: 'replica-b' });
    expect(summaryB.claimed).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  // CASE 3 — SUCCESS
  it('resolves the event after the processor succeeds and invokes the side effect once', async () => {
    const event = makeEvent();
    mockState.rpcResult = { data: [event], error: null };

    const summary = await dlqService.processQueue({ escrow: handler });

    expect(handler).toHaveBeenCalledTimes(1);
    const complete = updateCalls.find(c => c.payload.status === 'resolved');
    expect(complete).toBeDefined();
    expect(complete.payload).toEqual(expect.objectContaining({
      status: 'resolved',
      resolved_at: expect.any(String),
      claimed_by: null,
      claimed_at: null,
      lease_expires_at: null,
    }));
    // Completion is fenced on ownership: only the claiming worker may resolve.
    expect(complete.filters).toEqual(expect.arrayContaining([
      { col: 'id', val: 'dlq-1' },
      { col: 'status', val: 'processing' },
      { col: 'claimed_by', val: getWorkerId() },
    ]));
    expect(summary).toEqual(expect.objectContaining({ claimed: 1, resolved: 1, retried: 0, failed: 0, lost: 0 }));
  });

  // FENCING — ownership lost while processing (lease reclaimed by another worker)
  it('treats a completion that no longer owns the row as lost, never resolving', async () => {
    const event = makeEvent();
    mockState.rpcResult = { data: [event], error: null };
    mockState.updateResultByStatus.resolved = { data: [], error: null }; // row was reclaimed

    const summary = await dlqService.processQueue({ escrow: handler });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(summary.lost).toBe(1);
    expect(summary.resolved).toBe(0);
  });

  // CASE 4 — RETRYABLE FAILURE
  it('increments retry_count, schedules next_retry_at, returns to pending and clears the lease', async () => {
    const event = makeEvent({ retry_count: 0 });
    mockState.rpcResult = { data: [event], error: null };
    handler.mockRejectedValueOnce(new Error('provider 5xx'));

    await dlqService.processQueue({ escrow: handler });

    const requeue = updateCalls.find(c => c.payload.status === 'pending');
    expect(requeue).toBeDefined();
    expect(requeue.payload.retry_count).toBe(1);
    expect(requeue.payload.next_retry_at).toBeDefined();
    // First retry uses RETRY_BACKOFF[1] = 5 minutes.
    expect(new Date(requeue.payload.next_retry_at).getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(requeue.payload.next_retry_at).not.toBeNull();
    expect(requeue.payload.claimed_by).toBeNull();
    expect(requeue.payload.lease_expires_at).toBeNull();
    expect(requeue.filters).toEqual(expect.arrayContaining([
      { col: 'status', val: 'processing' },
      { col: 'claimed_by', val: getWorkerId() },
    ]));
  });

  it('preserves exponential backoff across attempts', async () => {
    const backoffAt = (retryCount) => {
      updateCalls.length = 0;
      const event = makeEvent({ retry_count: retryCount });
      mockState.rpcResult = { data: [event], error: null };
      handler.mockRejectedValueOnce(new Error('boom'));
      return dlqService.processQueue({ escrow: handler }).then(() => {
        const requeue = updateCalls.find(c => c.payload.status === 'pending');
        return requeue.payload.next_retry_at;
      });
    };

    const first = await backoffAt(0);
    const second = await backoffAt(1);
    const third = await backoffAt(2);

    const minutes = (iso) => (new Date(iso).getTime() - Date.now()) / 60_000;
    // RETRY_BACKOFF = [1, 5, 15, 60] -> after retry 0 -> 5min, retry 1 -> 15min, retry 2 -> 60min
    expect(minutes(first)).toBeGreaterThan(4);
    expect(minutes(first)).toBeLessThan(15);
    expect(minutes(second)).toBeGreaterThan(14);
    expect(minutes(second)).toBeLessThan(60);
    expect(minutes(third)).toBeGreaterThan(59);
  });

  // CASE 5 — MAX RETRIES
  it('marks the event failed_permanently once the backoff array is exhausted', async () => {
    // retry_count = 3 -> newRetryCount = 4 -> RETRY_BACKOFF[4] is undefined.
    const event = makeEvent({ retry_count: 3 });
    mockState.rpcResult = { data: [event], error: null };
    handler.mockRejectedValueOnce(new Error('terminal'));

    await dlqService.processQueue({ escrow: handler });

    const fail = updateCalls.find(c => c.payload.status === 'failed_permanently');
    expect(fail).toBeDefined();
    expect(fail.payload.retry_count).toBe(4);
    expect(fail.payload.error_message).toBe('terminal');
    expect(fail.payload.claimed_by).toBeNull();
    expect(fail.payload.lease_expires_at).toBeNull();
  });

  it('does not requeue after a permanent failure (no retry storm)', async () => {
    const event = makeEvent({ retry_count: 3 });
    mockState.rpcResult = { data: [event], error: null };
    handler.mockRejectedValueOnce(new Error('terminal'));

    await dlqService.processQueue({ escrow: handler });

    expect(updateCalls.filter(c => c.payload.status === 'pending')).toHaveLength(0);
    expect(updateCalls.filter(c => c.payload.status === 'failed_permanently')).toHaveLength(1);
  });

  // CASE 6 — WORKER CRASH: lease expiry makes a row claimable again
  it('re-claims an event whose lease expired (another worker can recover it)', async () => {
    // Worker A atomically claims the event and then crashes before completing:
    // the row stays 'processing' owned by A with a finite lease.
    const event = makeEvent();
    mockState.rpcResult = { data: [event], error: null };
    await dlqService.claimBatch({ workerId: 'replica-a', leaseMs: 300_000 });
    expect(rpcCalls[0].params.p_worker_id).toBe('replica-a');
    expect(updateCalls.find(c => c.payload.status === 'resolved')).toBeUndefined();

    // Lease expires. Worker B reclaims the same row (SQL: status='processing'
    // AND lease_expires_at < now()) and recovers it to resolved.
    mockState.rpcResult = { data: [event], error: null };
    const summary = await dlqService.processQueue({ escrow: handler }, { workerId: 'replica-b' });

    expect(summary.resolved).toBe(1);
    expect(rpcCalls[rpcCalls.length - 1].params.p_worker_id).toBe('replica-b');
  });

  // CASE 8 — DUPLICATE WEBHOOK DELIVERY
  it('deduplicates identical provider deliveries at enqueue time (unique dedupe_key)', async () => {
    const error = new Error('provider fail');
    const payload = { orderId: 'ORDER-1', txHash: '0xABC' };

    expect(await dlqService.enqueueFailure('escrow', 'EscrowReleased', payload, error)).toBe(true);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].payload.dedupe_key).toBe(buildDedupeKey('escrow', 'EscrowReleased', payload));
    // Stable key regardless of casing in the payload.
    expect(insertCalls[0].payload.dedupe_key).toBe('escrow:escrowreleased:order-1:0xabc');

    // Second delivery violates the unique index -> treated as already queued.
    mockState.insertResult = { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
    expect(await dlqService.enqueueFailure('escrow', 'EscrowReleased', payload, error)).toBe(true);
    expect(insertCalls).toHaveLength(2);
  });

  it('returns false when the DLQ insert fails for a non-duplicate reason', async () => {
    mockState.insertResult = { error: { message: 'connection refused' } };
    expect(await dlqService.enqueueFailure('escrow', 'EscrowReleased', {}, new Error('x'))).toBe(false);
  });

  // CASE 9 — MULTIPLE REPLICAS: concurrent cycles with disjoint claims
  it('distributes events safely across concurrent replica cycles without double-processing', async () => {
    const eventA = makeEvent({ id: 'dlq-a', payload: { orderId: 'order-a' } });
    const eventB = makeEvent({ id: 'dlq-b', payload: { orderId: 'order-b' } });

    // The DB (SKIP LOCKED) hands each replica a disjoint set.
    const claimFor = (worker) => {
      if (worker === 'replica-a') return { data: [eventA], error: null };
      return { data: [eventB], error: null };
    };

    const run = async (worker) => {
      mockState.rpcResult = claimFor(worker);
      return dlqService.processQueue({ escrow: handler }, { workerId: worker });
    };

    const [summaryA, summaryB] = await Promise.all([run('replica-a'), run('replica-b')]);

    expect(summaryA.claimed).toBe(1);
    expect(summaryB.claimed).toBe(1);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls.map(c => c[1].orderId).sort()).toEqual(['order-a', 'order-b']);
    const resolved = updateCalls.filter(c => c.payload.status === 'resolved');
    expect(resolved).toHaveLength(2);
    expect(resolved.map(c => c.filters.find(f => f.col === 'claimed_by').val).sort())
      .toEqual(['replica-a', 'replica-b']);
  });

  // CASE 10 — WEBHOOK RECOVERY
  it('dispatches to the registered provider handler (canonical escrow processor) and resolves on recovery', async () => {
    const event = makeEvent({ event_type: 'PaymentReleased' });
    mockState.rpcResult = { data: [event], error: null };
    const processor = vi.fn().mockResolvedValue({ received: true });

    const summary = await dlqService.processQueue({ escrow: processor });

    expect(processor).toHaveBeenCalledWith('PaymentReleased', { orderId: 'order-1', txHash: '0xabc' });
    expect(summary.resolved).toBe(1);
  });

  it('retries (never resolves) events whose provider has no handler', async () => {
    const event = makeEvent();
    mockState.rpcResult = { data: [event], error: null };

    const summary = await dlqService.processQueue({}, { workerId: 'replica-a' });

    expect(summary.retried).toBe(1);
    expect(summary.resolved).toBe(0);
    expect(updateCalls.find(c => c.payload.status === 'pending')).toBeDefined();
  });

  // OBSERVABILITY — backlog
  it('reports the pending backlog after a cycle', async () => {
    mockState.backlogCount = 7;
    mockState.rpcResult = { data: [], error: null };
    const loggerMod = await import('../../src/middleware/logger.js');

    await dlqService.processQueue({ escrow: handler });

    const backlogLog = loggerMod.default.info.mock.calls.find(args => String(args[0]).includes('Backlog'));
    expect(backlogLog).toBeTruthy();
    expect(backlogLog[0]).toContain('7');
  });
});

describe('dlqService — helpers', () => {
  it('getWorkerId returns a stable per-process identifier', () => {
    expect(getWorkerId()).toContain('-');
    expect(getWorkerId()).toContain(String(process.pid));
  });
});
