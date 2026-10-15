export function paginated({ page, limit, total }) {
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 10;
  const parsedPage = Number(page);
  
  // Fix: Normalize page to a minimum of 1 to prevent 0-indexed off-by-one errors
  // backend/api/src/lib/apiResponse.js

/**
 * Formats a standardized paginated API response.
 * @param {Array} data - Array of result items for the current page.
 * @param {number} total - Total count of matching records.
 * @param {number|string} page - Current page number.
 * @param {number|string} limit - Number of items per page.
 * @returns {Object} Standardized paginated response envelope.
 */
export function paginated(data, total, page, limit) {
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const totalPages = Math.max(1, Math.ceil(Number(total) / safeLimit));
  
  // Normalize page to a minimum bound of 1
  const normalizedPage = Math.max(1, parseInt(page, 10) || 1);

  // Compute robust boundary flags
  const hasNextPage = normalizedPage < totalPages;
  const hasPrevPage = normalizedPage > 1;

  return {
    success: true,
    data,
    pagination: {
      total: Number(total) || 0,
      page: normalizedPage,
      limit: safeLimit,
      totalPages,
      hasNextPage,
      hasPrevPage
    }
  };
}
  const safePage = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
  const safeTotal = Number.isFinite(Number(total)) && Number(total) >= 0 ? Number(total) : 0;
  
  const totalPages = Math.ceil(safeTotal / safeLimit) || 0;

  return {
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: safeTotal,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPrevPage: safePage > 1,
    },
  };
}

export default { paginated };
