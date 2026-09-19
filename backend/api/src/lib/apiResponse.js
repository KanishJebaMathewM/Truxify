/**
 * Standard API Response Helpers
 */

const MAX_PAGE_SIZE = 1000;

export function success(data = null, message = 'Success', statusCode = 200) {
  return {
    success: true,
    statusCode,
    message,
    data,
  };
}

export function error(message = 'An error occurred', statusCode = 500, errors = null) {
  const response = {
    success: false,
    statusCode,
    message,
  };

  if (errors !== null && errors !== undefined) {
    response.errors = errors;
  }

  return response;
}

export function paginated(data = [], page = 1, limit = 10, total = 0, message = 'Success') {
  const parsedPage = typeof page === 'number' ? page : (typeof page === 'string' && page.trim() !== '' ? Number(page) : NaN);
  const safePage = typeof parsedPage === 'number' && Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;

  const parsedLimit = typeof limit === 'number' ? limit : (typeof limit === 'string' && limit.trim() !== '' ? Number(limit) : NaN);
  const rawLimit = typeof parsedLimit === 'number' && Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
  const safeLimit = Math.min(rawLimit, MAX_PAGE_SIZE);

  const parsedTotal = typeof total === 'number' ? total : (typeof total === 'string' && total.trim() !== '' ? Number(total) : NaN);
  const safeTotal = typeof parsedTotal === 'number' && Number.isFinite(parsedTotal) ? Math.max(0, parsedTotal) : 0;

  const totalPages = Math.ceil(safeTotal / safeLimit) || 0;
  return {
    success: true,
    statusCode: 200,
    message,
    data,
    pagination: {
      page: safePage,
      pageSize: safeLimit,
      limit: safeLimit,
      total: safeTotal,
      totalPages,
      hasNextPage: safeTotal > 0 && safePage < totalPages,
      hasPrevPage: safeTotal > 0 && safePage > 1,
      hasPreviousPage: safeTotal > 0 && safePage > 1,
    },
  };
}

