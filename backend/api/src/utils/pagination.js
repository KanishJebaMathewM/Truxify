const DEFAULTS = {
  page: 1,
  limit: 20,
  maxLimit: 100,
};

// Cap the page number so `(page - 1) * limit` can never exceed
// Number.MAX_SAFE_INTEGER, which would silently produce a broken offset.
const MAX_PAGE = 1_000_000;

function normalizeNumber(value) {
  if (Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return Number.NaN;
}

export function buildPagination(params = {}) {
  const rawPage = normalizeNumber(params.page);
  const rawLimit = normalizeNumber(params.limit);
  const page = Number.isFinite(rawPage)
    ? Math.min(Math.max(1, Math.floor(rawPage)), MAX_PAGE)
    : DEFAULTS.page;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.floor(rawLimit)), DEFAULTS.maxLimit)
    : DEFAULTS.limit;

  const offset = (page - 1) * limit;
  const from = offset;
  const to = offset + limit - 1;

  return { page, limit, offset, from, to };
}
