// Stub for spec 29
// === Spec 29: deterministic order IDs in backfill ===
export function sortOrderIdsDeterministically(ids) {
  if (!Array.isArray(ids)) return [];
  return [...ids].sort((a, b) => { const sa = String(a), sb = String(b); return sa < sb ? -1 : sa > sb ? 1 : 0; });
}

