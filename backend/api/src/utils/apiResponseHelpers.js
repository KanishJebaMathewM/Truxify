/**
 * Structured API response builders for consistent response formatting.
 *
 * @module apiResponseHelpers
 */

/**
 * Build a success API response with optional metadata.
 * @param {unknown} data - The response data payload
 * @param {object} [meta] - Optional metadata (pagination, etc.)
 * @returns {{ success: boolean, data: unknown, meta?: object }}
 */
export function success(data, meta) {
  const response = { success: true, data };
  if (meta !== undefined) {
    response.meta = meta;
  }
  return response;
}

/**
 * Build an error API response.
 * @param {string} message - Human-readable error message
 * @param {string} [code] - Machine-readable error code
 * @param {unknown} [details] - Additional error details
 * @returns {{ success: false, error: string, code?: string, details?: unknown }}
 */
export function error(message, code, details) {
  const response = { success: false, error: message };
  if (code !== undefined) {
    response.code = code;
  }
  if (details !== undefined) {
    response.details = details;
  }
  return response;
}
