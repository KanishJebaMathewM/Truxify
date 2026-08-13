// Stub for spec 26
// === Spec 26: backoff retry for outbox relay ===
const MAX = 5, BASE = 100;
export async function publishWithBackoff(fn, payload) {
  let lastErr;
  for (let a = 1; a <= MAX; a++) {
    try { return await fn(payload, a); }
    catch (e) {
      lastErr = e;
      if (a < MAX) await new Promise((r) => setTimeout(r, BASE * 2 ** (a - 1)));
    }
  }
  throw lastErr;
}

