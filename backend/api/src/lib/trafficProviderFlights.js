// Owners cover fetch and JSON consumption; caller expiry is not native cancellation.
const flights = new Map();
const MAX_NATIVE = 8;
const DEADLINE_MS = 5000;

/** Share an exact provider request while retaining admission until native settlement. */
export function fetchTrafficData(url, provider) {
  const existing = flights.get(url);
  if (existing) return existing.result;
  if (flights.size >= MAX_NATIVE) {
    return Promise.reject(new Error('Traffic provider admission exhausted'));
  }

  const controller = new AbortController();
  const owner = {};
  let timer;
  const expiry = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Traffic provider deadline exceeded');
      controller.abort(error);
      reject(error);
    }, DEADLINE_MS);
  });
  const native = Promise.resolve().then(async () => {
    const response = await fetch(url, { signal: controller.signal });
    controller.signal.throwIfAborted();
    if (!response.ok) {
      // Dispose the unused error body before releasing native admission.
      await response.body?.cancel();
      throw new Error(`${provider} API error: ${response.status}`);
    }
    const data = await response.json();
    controller.signal.throwIfAborted();
    return data;
  }).finally(() => {
    clearTimeout(timer);
    if (flights.get(url) === owner) flights.delete(url);
  });
  // Promise.race observes late native rejection even after the deadline wins.
  owner.result = Promise.race([native, expiry]);
  flights.set(url, owner);
  return owner.result;
}
