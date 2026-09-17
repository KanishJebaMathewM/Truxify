export function formatError(code, message, details = undefined) {
  const err = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (process.env.NODE_ENV !== "production" && details) {
    err.error = { ...err.error, details };
  }

  return err;
}