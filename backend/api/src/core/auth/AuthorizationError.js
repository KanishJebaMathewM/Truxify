/**
 * Structured error for authorization failures.
 *
 * Carries a status code and a machine-readable error code in addition to the
 * human message, so that callers can distinguish between 401/403 and map to
 * appropriate HTTP responses without inspecting strings.
 */

export class AuthorizationError extends Error {
  /**
   * @param {number} status       - HTTP status code (401 or 403)
   * @param {string} message      - Human-readable denial reason
   * @param {string} [errorCode]  - Machine-readable code (e.g. "ROLE_NOT_ALLOWED")
   */
  constructor(status, message, errorCode) {
    super(message);
    this.name = 'AuthorizationError';
    this.status = status;
    this.errorCode = errorCode || AuthorizationError._inferCode(status);
  }

  static _inferCode(status) {
    if (status === 401) return 'UNAUTHENTICATED';
    if (status === 403) return 'FORBIDDEN';
    return 'AUTHORIZATION_ERROR';
  }

  toJSON() {
    return {
      error: this.message,
      errorCode: this.errorCode,
      status: this.status,
    };
  }
}

export default AuthorizationError;
