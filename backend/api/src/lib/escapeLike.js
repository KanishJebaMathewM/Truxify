export function escapeLike(value) {
  if (value == null) return value;
  if (typeof value !== 'string') return String(value);
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

