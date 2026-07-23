export function formatError(code, message, details = undefined) {
  const error = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (process.env.NODE_ENV !== "production" && details) {
    error.error.details = details;
  }

  return error;
}