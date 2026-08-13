/**
 * SQL LIKE operator escape utility.
 *
 * Escapes special characters in user-supplied strings before using them in
 * SQL LIKE clauses to prevent LIKE injection attacks.
 *
 * The backslash character MUST be escaped first so that subsequent escapes
 * are not unescaped by the database. Additionally, SQL LIKE wildcard
 * characters ([ ] % _) and backslash are escaped.
 *
 * @param {string|null|undefined} value - The string to escape for SQL LIKE
 * @returns {string|null|undefined} The escaped string, or original value if null/undefined
 *
 * @example
 * const escaped = escapeLike("100%_path");
 * // Returns: "100\%\_path"
 *
 * @see {@link https://owasp.org/www-community/attacks/SQL_Injection}
 */

export function escapeLike(value) {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  if (value === '') return value;
  // Backslash must be escaped first so the escapes applied after it are not
  // themselves unescaped by the database. `[`/`]` are wildcard brackets in
  // some LIKE dialects (e.g. MySQL default), so escape them too.
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}
