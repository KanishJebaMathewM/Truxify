export function escapeLike(value) {
  if (value == null) return value;
  if (typeof value !== 'string') return String(value);
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}


// === Spec 17: ===
// === Spec 17: SQL wildcard escape ===
const W = ['\\', '%', '_', '[', ']'];
export function escapeSqlLike(value) {
  if (value == null) return value;
  if (typeof value !== 'string') return String(value);
  let out = value;
  for (const ch of W) out = out.split(ch).join('\\' + ch);
  return out;
}

