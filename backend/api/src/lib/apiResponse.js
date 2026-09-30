export function paginated({ page, limit, total }) {
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 10;
  const parsedPage = Number(page);
  
  // Fix: Normalize page to a minimum of 1 to prevent 0-indexed off-by-one errors
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
