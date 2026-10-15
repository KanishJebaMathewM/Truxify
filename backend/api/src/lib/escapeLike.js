export function escapeLike(value) {
  if (value == null) return value;
  if (typeof value !== 'string') return String(value);
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

export function escapeSqlLike(value) {
  if (value == null) return value;
  if (typeof value !== 'string') return String(value);
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}


