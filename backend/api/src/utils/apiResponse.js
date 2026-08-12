export function errorResponse(code, message, details) {
  const response = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (
    process.env.NODE_ENV !== "production" &&
    details !== undefined
  ) {
    response.error.details = details;
  }

  return response;
}