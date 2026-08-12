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
