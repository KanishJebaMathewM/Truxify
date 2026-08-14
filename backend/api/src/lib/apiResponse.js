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
  const safePage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
  const rawLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 10;
  const safeLimit = Math.min(rawLimit, MAX_PAGE_SIZE);
  const safeTotal = Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : 0;
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
      hasNextPage: safePage < totalPages,
      hasPrevPage: safePage > 1,
    },
  };
}
