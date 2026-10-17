function identifier(value, label, optional = false) {
  if (optional && (value === undefined || value === null)) return value;
  if ((typeof value === 'string' && value.trim() && value.length <= 256) || (Number.isSafeInteger(value) && value >= 0)) return value;
  throw new TypeError(`${label} must be a bounded identifier`);
}
function finite(value, label, lower, upper) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < lower || value > upper) throw new RangeError(`${label} is outside its finite domain`);
  return value;
}
function recordedAt(value) {
  if (value === undefined) return new Date().toISOString();
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) throw new RangeError('timestamp must be valid integer milliseconds');
    return new Date(value).toISOString();
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime()) || value.getTime() < 0) throw new RangeError('timestamp Date must be valid and nonnegative');
    return new Date(value.getTime()).toISOString();
  }
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) {
    const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, part) => `.${(part ?? '').padEnd(3, '0')}Z`);
    const date = new Date(normalized);
    if (Number.isFinite(date.getTime()) && date.getTime() >= 0 && date.toISOString() === normalized) return normalized;
  }
  throw new TypeError('timestamp must be milliseconds, Date or an explicit valid UTC ISO observation');
}
export function admitTrajectoryPoint(point) {
  if (!point || typeof point !== 'object' || Array.isArray(point)) throw new TypeError('trajectory point must be a complete object');
  const { tripId, driverId, lat, lng, speedMps, heading, roadName, timestamp } = point;
  if (roadName !== undefined && roadName !== null && (typeof roadName !== 'string' || roadName.length > 512)) throw new TypeError('road name must be a bounded string');
  return Object.freeze({ trip_id: identifier(tripId, 'trip'), driver_id: identifier(driverId, 'driver', true),
    lat: finite(lat, 'latitude', -90, 90), lng: finite(lng, 'longitude', -180, 180),
    speed_mps: finite(speedMps ?? 0, 'speed', 0, 10000), heading: finite(heading ?? 0, 'heading', 0, 360),
    road_name: roadName ?? null, recorded_at: recordedAt(timestamp) });
}
export function boundedInteger(value, fallback, label, upper) {
  const number = value ?? fallback;
  if (!Number.isSafeInteger(number) || number < 1 || number > upper) throw new RangeError(`${label} must be a positive bounded integer`);
  return number;
}
