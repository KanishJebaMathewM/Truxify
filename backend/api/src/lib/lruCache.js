// Created by spec 3
// === Spec 3: max key threshold [10, 100000] ===
const MIN_KEYS = 10;
const MAX_KEYS = 100_000;
export function clampMaxKeys(value, fallback = 1000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < MIN_KEYS) return MIN_KEYS;
  if (n > MAX_KEYS) return MAX_KEYS;
  return n;
}

