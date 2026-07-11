const DEFAULTS = {
  page: 1,
  limit: 20,
  maxLimit: 100,
};

export function buildPagination(params = {}) {
  const page = Number.isFinite(params.page) ? Math.max(1, Math.floor(params.page)) : DEFAULTS.page;
  const limit = Number.isFinite(params.limit)
    ? Math.min(Math.max(1, Math.floor(params.limit)), DEFAULTS.maxLimit)
    : DEFAULTS.limit;

  const offset = (page - 1) * limit;
  const from = offset;
  const to = offset + limit - 1;

  return { page, limit, offset, from, to };
}
