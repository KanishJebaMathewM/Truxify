/**
 * Standard API Response Helpers
 */

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
  // Guard against a non-positive or non-finite limit so the pagination
  // envelope never contains Infinity (e.g. limit=0 would otherwise make
  // totalPages = Math.ceil(total/0) = Infinity).
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 1;
  const safePage = Number.isFinite(Number(page)) ? Number(page) : 1;
  const safeTotal = Number.isFinite(Number(total)) ? Number(total) : 0;
  const totalPages = Math.ceil(safeTotal / safeLimit) || 0;
  return {
    success: true,
    statusCode: 200,
    message,
    data,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: safeTotal,
      totalPages,
      hasNextPage: safePage > 0 && safePage < totalPages,
      hasPrevPage: safePage > 1,
    },
  };
}
