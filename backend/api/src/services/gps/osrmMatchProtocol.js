/** Complete owned observation and OSRM Match admission; no fabricated confidence. */
export const MAX_TRAJECTORY_POINTS = 100;
export const MAX_MATCH_RESPONSE_BYTES = 512 * 1024;

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function coordinate(lat, lng) {
  finite(lat, 'latitude');
  finite(lng, 'longitude');
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new RangeError('coordinates must be geographic latitude/longitude');
  }
}

export function admitTrajectory(points) {
  if (!Array.isArray(points) || points.length > MAX_TRAJECTORY_POINTS) {
    throw new TypeError('trajectory must be an array of at most 100 points');
  }
  const owned = Array.from(points, (point) => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) {
      throw new TypeError('trajectory points must be complete objects');
    }
    const { lat, lng, timestamp, accuracy } = point;
    coordinate(lat, lng);
    if (timestamp !== undefined && (!Number.isSafeInteger(timestamp) || timestamp < 0)) {
      throw new RangeError('timestamps must be nonnegative safe integer milliseconds');
    }
    if (accuracy !== undefined && (finite(accuracy, 'accuracy') < 0)) {
      throw new RangeError('accuracy must be nonnegative');
    }
    return { lat, lng, timestamp, accuracy };
  });
  const timed = owned.filter((point) => point.timestamp !== undefined).length;
  if (timed && timed !== owned.length) {
    throw new TypeError('timestamps must be supplied for every point or omitted entirely');
  }
  for (let index = 1; index < owned.length; index += 1) {
    if (timed && owned[index].timestamp < owned[index - 1].timestamp) {
      throw new RangeError('observation timestamps must not move backwards');
    }
  }
  return owned;
}

export function rawMatch(point, reason) {
  return {
    lat: point.lat, lng: point.lng, confidence: 0, roadName: '',
    matched: false, source: 'input', reason, matchingIndex: null,
  };
}

export function admitMatchResponse(data, points) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('OSRM match response must be an object');
  }
  if (data.code === 'NoMatch') {
    return points.map((point) => rawMatch(point, 'no_match'));
  }
  if (data.code !== 'Ok' || !Array.isArray(data.matchings)
      || !data.matchings.length || data.matchings.length > points.length
      || !Array.isArray(data.tracepoints) || data.tracepoints.length !== points.length) {
    throw new TypeError('OSRM match response must have complete matching/tracepoint cardinality');
  }
  const confidence = Array.from(data.matchings, (matching) => {
    if (!matching || typeof matching !== 'object' || Array.isArray(matching)) {
      throw new TypeError('OSRM matching must be an object');
    }
    const value = finite(matching.confidence, 'matching confidence');
    if (value < 0 || value > 1) throw new RangeError('matching confidence must be in [0,1]');
    return value;
  });
  return Array.from(data.tracepoints, (tracepoint, index) => {
    if (tracepoint === null) return rawMatch(points[index], 'outlier');
    if (!tracepoint || typeof tracepoint !== 'object' || Array.isArray(tracepoint)
        || !Array.isArray(tracepoint.location) || tracepoint.location.length !== 2
        || !Number.isInteger(tracepoint.matchings_index) || tracepoint.matchings_index < 0
        || tracepoint.matchings_index >= confidence.length) {
      throw new TypeError('OSRM tracepoint must identify one complete matching and coordinate');
    }
    const [lng, lat] = tracepoint.location;
    coordinate(lat, lng);
    if (tracepoint.name !== undefined && (typeof tracepoint.name !== 'string' || tracepoint.name.length > 512)) {
      throw new TypeError('OSRM road name must be a bounded string');
    }
    return {
      lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)),
      confidence: Number(confidence[tracepoint.matchings_index].toFixed(3)),
      roadName: tracepoint.name ?? '', matched: true, source: 'osrm', reason: 'matched',
      matchingIndex: tracepoint.matchings_index,
    };
  });
}
