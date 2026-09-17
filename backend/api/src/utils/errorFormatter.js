/**
 * Formats structured error responses for API consumers.
 *
 * @param {string|Error|object|null|undefined} codeOrError - Error code string, Error instance, or plain error object
 * @param {string|object|null|undefined} [messageOrDetails] - Error message string or details object
 * @param {object|Array|null|undefined} [details] - Optional extra error details
 * @returns {{ success: false, error: { code: string, message: string, details?: any } }}
 */
export function formatError(codeOrError, messageOrDetails, details = undefined) {
  let code = 'INTERNAL_ERROR';
  let message = 'An error occurred';
  let resolvedDetails = details;

  if (codeOrError instanceof Error) {
    code = codeOrError.code || codeOrError.name || 'INTERNAL_ERROR';
    message = codeOrError.message || message;
    if (resolvedDetails === undefined) {
      resolvedDetails = messageOrDetails !== undefined ? messageOrDetails : (codeOrError.details || undefined);
    }
  } else if (codeOrError && typeof codeOrError === 'object') {
    code = codeOrError.code || code;
    message = codeOrError.message || message;
    if (resolvedDetails === undefined) {
      resolvedDetails = codeOrError.details !== undefined ? codeOrError.details : messageOrDetails;
    }
  } else {
    if (codeOrError !== undefined && codeOrError !== null) {
      code = String(codeOrError);
    }
    if (messageOrDetails !== undefined && messageOrDetails !== null) {
      message = typeof messageOrDetails === 'string' ? messageOrDetails : JSON.stringify(messageOrDetails);
    } else if (codeOrError && typeof codeOrError === 'string' && messageOrDetails === undefined) {
      message = codeOrError;
    }
  }

  const response = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (process.env.NODE_ENV !== 'production' && resolvedDetails !== undefined && resolvedDetails !== null) {
    response.error.details = resolvedDetails;
  }

  return response;
}