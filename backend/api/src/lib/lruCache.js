// Created by spec 3
// === Spec 3: max key threshold [10, 100000] ===
const MIN_KEYS = 10;
const MAX_KEYS = 100_000;
const INTERNAL_FALLBACK = 1000;
export function clampMaxKeys(value, fallback = INTERNAL_FALLBACK) {
  const n = Number(value);
  const effectiveFallback = Number.isFinite(fallback) ? fallback : INTERNAL_FALLBACK;
  if (!Number.isFinite(n)) return effectiveFallback;
  if (n < MIN_KEYS) return MIN_KEYS;
  if (n > MAX_KEYS) return MAX_KEYS;
  return n;
}

