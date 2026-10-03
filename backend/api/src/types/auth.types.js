/**
 * @typedef {Object} TruxifyUser
 * @property {string} id - The unique identifier for the user.
 * @property {string} uid - The Firebase or Supabase UID.
 * @property {string} role - The user's role (e.g., 'customer', 'driver', 'admin').
 * @property {string} [fullName] - The user's full name.
 * @property {string} [phone] - The user's phone number.
 * @property {string} [email] - The user's email address.
 * @property {boolean} isActive - Whether the user's account is active.
 */

/**
 * @typedef {Object} AuthRequest
 * @property {TruxifyUser} [user] - The authenticated user object.
 * @property {string} [token] - The raw JWT token.
 * @property {string} [requestId] - Unique identifier for the request.
 */

/**
 * Validates if a user object has the required properties.
 * @param {any} user - The user object to validate.
 * @returns {user is TruxifyUser} True if valid, false otherwise.
 */
export function isValidTruxifyUser(user) {
    return (
        user !== null &&
        typeof user === 'object' &&
        typeof user.id === 'string' &&
        typeof user.uid === 'string' &&
        typeof user.role === 'string' &&
        typeof user.isActive === 'boolean'
    );
}

/**
 * Sanitizes an array of roles, removing invalid entries.
 * @param {any[]} roles - The array of roles to sanitize.
 * @returns {string[]} A sanitized array of role strings.
 */
export function sanitizeRoles(roles) {
    if (!Array.isArray(roles)) return [];
    return roles
        .map(r => typeof r === "string" ? r.trim() : "")
        .filter(r => r.length > 0);
}
