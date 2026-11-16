function number(value, name, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max ||
      (integer && !Number.isSafeInteger(value))) throw new TypeError(`Invalid GPS ${name}`);
  return value;
}
function id(value, name, optional = false) {
  if (optional && value === undefined) return 'unknown';
  if ((typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value) ||
      (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return value;
  throw new TypeError(`Invalid GPS ${name}`);
}
export function admitStreamPing(ping) {
  if (!ping || typeof ping !== 'object' || Array.isArray(ping)) throw new TypeError('Invalid GPS ping');
  return Object.freeze({
    tripId: id(ping.tripId, 'tripId'), driverId: id(ping.driverId, 'driverId', true),
    lat: number(ping.lat, 'latitude', -90, 90), lng: number(ping.lng, 'longitude', -180, 180),
    speed: number(ping.speed === undefined ? 0 : ping.speed, 'speed', 0, 10000),
    heading: number(ping.heading === undefined ? 0 : ping.heading, 'heading', 0, 360),
    accuracy: number(ping.accuracy === undefined ? 5 : ping.accuracy, 'accuracy', 0, 1e6),
    timestamp: number(ping.timestamp === undefined ? Date.now() : ping.timestamp,
      'timestamp', 0, 8640000000000000, true),
  });
}
export function streamPolicy(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Invalid GPS options');
  const streamKey = options.streamKey === undefined ? 'gps:stream:trips' : options.streamKey;
  if (typeof streamKey !== 'string' || !streamKey.trim() || streamKey.length > 256) throw new TypeError('Invalid GPS streamKey');
  return Object.freeze({streamKey,
    maxTrips: number(options.maxTrips === undefined ? 10000 : options.maxTrips, 'maxTrips', 1, 100000, true),
    maxStreamEntries: number(options.maxStreamEntries === undefined ? 100000 : options.maxStreamEntries, 'maxStreamEntries', 1, 10000000, true),
    acknowledgementTimeoutMs: number(options.acknowledgementTimeoutMs === undefined ? 10000 : options.acknowledgementTimeoutMs,
      'acknowledgementTimeoutMs', 1, 60000, true),
  });
}
export function admittedSmoothed(value) {
  return {
    lat: number(value?.lat, 'smoothed latitude', -90, 90),
    lng: number(value?.lng, 'smoothed longitude', -180, 180),
    speedMps: number(value?.speedMps, 'smoothed speed', 0, 1e9),
  };
}
