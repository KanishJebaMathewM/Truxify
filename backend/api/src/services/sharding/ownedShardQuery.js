// Capacity belongs to unfinished native work, not to callers that have timed out.
const pendingByPool = new WeakMap();
export const DEFAULT_SHARD_QUERY_TIMEOUT_MS = 5000;
export const MAX_SHARD_QUERY_TIMEOUT_MS = 30000;
export const MAX_PENDING_SHARD_QUERIES = 10;

export function validateShardQueryTimeout(value = DEFAULT_SHARD_QUERY_TIMEOUT_MS) {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_SHARD_QUERY_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be finite, positive and at most ${MAX_SHARD_QUERY_TIMEOUT_MS}`);
  }
  return value;
}

function failure(message, code, shard) {
  return Object.assign(new Error(message), { code, shard });
}

/** Own checkout, SQL dispatch and release through one monotonic caller budget. */
export function executeOwnedShardQuery(pool, text, values, { timeoutMs, shard }) {
  const budget = validateShardQueryTimeout(timeoutMs);
  const pending = pendingByPool.get(pool) || 0;
  if (pending >= MAX_PENDING_SHARD_QUERIES) {
    return Promise.reject(failure(`Query admission saturated on shard ${shard}`, 'ESHARDSATURATED', shard));
  }
  pendingByPool.set(pool, pending + 1);
  const deadline = performance.now() + budget;
  const timeoutError = failure(`Query timed out on shard ${shard}`, 'ETIMEDOUT', shard);
  let client, released = false, expired = false, completed = false, timer;
  let resolveCaller, rejectCaller;
  const caller = new Promise((resolve, reject) => { resolveCaller = resolve; rejectCaller = reject; });
  const release = error => {
    if (!client || released) return;
    released = true;
    client.release(error); // pg removes/destroys the owned client on an error.
  };
  const finish = (error, result) => {
    if (completed) return;
    completed = true;
    clearTimeout(timer);
    if (error) rejectCaller(error); else resolveCaller(result);
  };
  timer = setTimeout(() => {
    expired = true;
    try { release(timeoutError); } catch { /* Native retirement failed; keep admission until settlement. */ }
    finish(timeoutError);
  }, budget);

  // Always observe the native promise after caller expiry. A late checkout is
  // retired before SQL starts; pending admission survives until this work settles.
  void Promise.resolve().then(async () => {
    try {
      client = await pool.connect();
      if (expired || performance.now() >= deadline) throw timeoutError;
      const result = await client.query({ text, values, query_timeout: Math.max(1, deadline - performance.now()) });
      if (expired || performance.now() >= deadline) throw timeoutError;
      release();
      finish(null, result);
    } catch (error) {
      try { release(error); } catch { /* Do not replace the original query/timeout failure. */ }
      finish(error);
    } finally {
      const remaining = (pendingByPool.get(pool) || 1) - 1;
      if (remaining) pendingByPool.set(pool, remaining); else pendingByPool.delete(pool);
    }
  });
  return caller;
}
