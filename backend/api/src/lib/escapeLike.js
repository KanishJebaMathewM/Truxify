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


// === Spec 17: ===
// === Spec 17: SQL wildcard escape ===
const W = ['\\', '%', '_', '[', ']'];
export function escapeSqlLike(value) {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  if (value === '') return value;
  let out = value;
  for (const ch of W) out = out.split(ch).join('\\' + ch);
  return out;
}

