// Created by spec 5
// === Spec 5: validate pagination bounds ===
const MAX_OFFSET = 1_000_000;
export function validatePagination({ page = 1, pageSize = 20 } = {}) {
  const p = Number(page);
  const ps = Number(pageSize);
  if (!Number.isFinite(p) || p < 1) return { error: 'page must be >= 1' };
  if (!Number.isFinite(ps) || ps < 1) return { error: 'pageSize must be >= 1' };
  if (ps > 200) return { error: 'pageSize must be <= 200' };
  const offset = (p - 1) * ps;
  if (offset > MAX_OFFSET) return { error: `offset ${offset} exceeds MAX_OFFSET ${MAX_OFFSET}`, status: 400 };
  return { page: p, pageSize: ps, offset, limit: ps };
}

