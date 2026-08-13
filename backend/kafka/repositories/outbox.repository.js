// Stub for spec 30
// === Spec 30: SELECT FOR UPDATE SKIP LOCKED ===
export const RESERVE_OUTBOX_SQL = `SELECT id FROM event_outbox WHERE status = 'PENDING' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1`;
export function isReservationResult(arr) { return Array.isArray(arr); }

