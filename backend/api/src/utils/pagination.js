const DEFAULTS = {
  page: 1,
  limit: 20,
  maxLimit: 100,
};

function normalizeNumber(value) {
  if (Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return Number.NaN;
}

export function parsePage(raw) {
  const p = normalizeNumber(raw);
  if (!Number.isFinite(p) || p < 1) return 1;
  return Math.floor(p);
}

export function parseLimit(raw, max = DEFAULTS.maxLimit) {
  const l = normalizeNumber(raw);
  if (!Number.isFinite(l) || l < 1) return DEFAULTS.limit;
  const maxLimit = Number.isFinite(max) ? max : DEFAULTS.maxLimit;
  return Math.min(Math.floor(l), maxLimit);
}

export function buildPagination(params = {}) {
  const maxLimit = Number.isFinite(normalizeNumber(params.maxLimit))
    ? Math.max(1, Math.floor(normalizeNumber(params.maxLimit)))
    : DEFAULTS.maxLimit;

  const rawPage = normalizeNumber(params.page);
  const rawLimit = normalizeNumber(params.limit);
  const rawOffset = normalizeNumber(params.offset);

  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.floor(rawLimit)), maxLimit)
    : DEFAULTS.limit;

  let page;
  let offset;

  if (Number.isFinite(rawOffset)) {
    offset = Math.max(0, Math.floor(rawOffset));
    page = Math.floor(offset / limit) + 1;
  } else {
    page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : DEFAULTS.page;
    offset = (page - 1) * limit;
  }

  const from = offset;
  const to = offset + limit - 1;

  return { page, limit, offset, from, to };
}

export function calculatePagination({ total = 0, page = 1, limit = 20, offset = null } = {}) {
  const safeTotal = Math.max(0, Number.isFinite(Number(total)) ? Math.floor(Number(total)) : 0);
  const pagination = buildPagination({ page, limit, offset });
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / pagination.limit);
  const isFirstPage = pagination.page === 1;
  const isLastPage = totalPages === 0 || pagination.page >= totalPages;
  const hasNextPage = safeTotal > 0 && pagination.page < totalPages;
  const hasPrevPage = safeTotal > 0 && pagination.page > 1;
  const isOverflow = safeTotal > 0 && pagination.offset >= safeTotal;
  const isEmpty = safeTotal === 0;

  return {
    ...pagination,
    total: safeTotal,
    totalCount: safeTotal,
    totalPages,
    isFirstPage,
    isLastPage,
    hasNextPage,
    hasPrevPage,
    hasPreviousPage: hasPrevPage,
    isOverflow,
    isEmpty,
  };
}

export function getPaginationMeta(total, page, limit) {
  return calculatePagination({ total, page, limit });
}

export function formatPaginationMeta(total = 0, page = 1, limit = 20) {
  const meta = calculatePagination({ total, page, limit });
  return {
    page: meta.page,
    limit: meta.limit,
    total: meta.total,
    totalPages: meta.totalPages,
    hasNextPage: meta.hasNextPage,
    hasPreviousPage: meta.hasPreviousPage,
  };
}

export function paginateArray(items = [], params = {}) {
  if (!Array.isArray(items)) {
    return { data: [], pagination: calculatePagination({ total: 0, ...params }) };
  }
  const pagination = calculatePagination({ total: items.length, ...params });
  const data = items.slice(pagination.offset, pagination.offset + pagination.limit);
  return {
    data,
    pagination,
  };
}

export default {
  buildPagination,
  parsePage,
  parseLimit,
  calculatePagination,
  getPaginationMeta,
  formatPaginationMeta,
  paginateArray,
};
