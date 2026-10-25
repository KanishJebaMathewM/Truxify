export const CANDIDATE_FIELDS = ['id', 'customer_id', 'pickup_address', 'drop_address', 'pickup_lat', 'pickup_lng', 'drop_lat', 'drop_lng', 'weight_kg', 'price_paisa', 'pickup_time_window_start', 'pickup_time_window_end', 'status'];
export const MAX_CANDIDATES = 50;

function finite(value, label, decimal = false) {
  let admitted = value;
  if (decimal && typeof value === 'string' && value.length <= 64 && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) admitted = Number(value);
  if (typeof admitted !== 'number' || !Number.isFinite(admitted)) throw new TypeError(`${label} must be finite`);
  return admitted;
}
export function ownedBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('bounding box must be an object');
  const box = Object.fromEntries(['minLng', 'maxLng', 'minLat', 'maxLat'].map(key => [key, finite(value[key], key)]));
  if (box.minLng < -180 || box.maxLng > 180 || box.minLng > box.maxLng
      || box.minLat < -90 || box.maxLat > 90 || box.minLat > box.maxLat) throw new RangeError('bounds must be ordered geographic coordinates');
  return Object.freeze(box);
}

/** Explicit UTC/offset ISO, Date, or nonnegative integer epoch; no implementation-dependent local date strings. */
export function timeEpoch(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000) return value;
  if (value instanceof Date && Number.isFinite(value.getTime()) && value.getTime() >= 0) return value.getTime();
  if (typeof value !== 'string' || value.length > 40) throw new TypeError('time must be explicit valid observation metadata');
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!parts) throw new TypeError('time must include an explicit ISO timezone');
  const [year, month, day, hours, minutes, seconds] = parts.slice(1, 7).map(Number);
  const millis = Number((parts[7] ?? '').padEnd(3, '0'));
  const calendar = new Date(0); calendar.setUTCFullYear(year, month - 1, day); calendar.setUTCHours(hours, minutes, seconds, millis);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day
      || calendar.getUTCHours() !== hours || calendar.getUTCMinutes() !== minutes || calendar.getUTCSeconds() !== seconds) throw new RangeError('time calendar must be valid');
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new RangeError('time must be a nonnegative valid epoch');
  return epoch;
}
export function ownedFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new TypeError('filters must be an object');
  for (const key of Object.keys(filters)) {
    if (!['maxWeightKg', 'driverEarliestDeparture'].includes(key) && filters[key] !== undefined) {
      throw new TypeError(`unsupported constraint: ${key}`);
    }
  }
  const weight = filters.maxWeightKg === undefined ? undefined : finite(filters.maxWeightKg, 'maximum weight');
  if (weight !== undefined && (weight < 0 || weight > 1e9)) throw new RangeError('maximum weight must be in [0,1000000000]');
  const departure = filters.driverEarliestDeparture === undefined ? undefined : timeEpoch(filters.driverEarliestDeparture);
  return Object.freeze({ weight, departure });
}
function window(start, end) {
  const lower = start === null || start === undefined ? null : timeEpoch(start);
  const upper = end === null || end === undefined ? null : timeEpoch(end);
  if (lower !== null && upper !== null && lower > upper) throw new RangeError('pickup window must be ordered');
  return { lower, upper };
}
export function timeWindowFeasible(eta, start, end) {
  try {
    const observed = timeEpoch(eta); const { lower, upper } = window(start, end);
    return (lower === null || observed >= lower) && (upper === null || observed <= upper);
  } catch { return false; }
}
export function admitRows(data, box, filters) {
  if (!Array.isArray(data) || data.length > MAX_CANDIDATES) throw new TypeError('observed query must contain at most 50 complete rows');
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 1024 * 1024) throw new RangeError('decoded spatial response exceeds 1MiB');
  return Array.from(data, row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('candidate row must be an object');
    const owned = {};
    for (const key of CANDIDATE_FIELDS) {
      if (!Object.hasOwn(row, key)) throw new TypeError(`missing selected candidate field: ${key}`);
      const value = row[key];
      if (value !== null && !['string', 'number'].includes(typeof value)) throw new TypeError('selected candidate fields must be JSON primitives');
      if ((typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && value.length > 2048)) throw new RangeError('candidate primitive exceeds finite/text bounds');
      owned[key] = value;
    }
    if (owned.status !== 'PENDING' || (!((typeof owned.id === 'string' && owned.id.trim()) || (Number.isSafeInteger(owned.id) && owned.id >= 0)))) throw new TypeError('row must identify one pending load');
    const lat = finite(owned.pickup_lat, 'pickup latitude', true); const lng = finite(owned.pickup_lng, 'pickup longitude', true);
    const dropLat = finite(owned.drop_lat, 'drop latitude', true); const dropLng = finite(owned.drop_lng, 'drop longitude', true);
    if (lat < box.minLat || lat > box.maxLat || lng < box.minLng || lng > box.maxLng || Math.abs(dropLat) > 90 || Math.abs(dropLng) > 180) throw new RangeError('row contradicts geographic query bounds');
    const weight = owned.weight_kg === null ? null : finite(owned.weight_kg, 'candidate weight', true);
    if ((weight !== null && weight < 0) || (filters.weight !== undefined && (weight === null || weight > filters.weight))) throw new RangeError('row contradicts weight constraint');
    const { upper } = window(owned.pickup_time_window_start, owned.pickup_time_window_end);
    if (filters.departure !== undefined && upper !== null && upper < filters.departure) throw new RangeError('row contradicts earliest departure expiry constraint');
    return owned;
  });
}
