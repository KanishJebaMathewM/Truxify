const MAX_DATE_MS = 8640000000000000;
const MAX_NOISE_VARIANCE = 1e12;
const METERS_PER_DEGREE = 111320;

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function observation(lat, lng, timestamp, accuracy) {
  finite(lat, 'latitude');
  finite(lng, 'longitude');
  finite(accuracy, 'accuracy');
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new RangeError('coordinates must be geographic');
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > MAX_DATE_MS) {
    throw new RangeError('timestamp must be nonnegative integer milliseconds in the Date range');
  }
  if (accuracy < 0 || accuracy > 1e6) throw new RangeError('accuracy must be in [0,1000000] metres');
  return Object.freeze({ lat, lng, timestamp, accuracy });
}

function wrappedDegrees(value) {
  const result = value % 360;
  if (result > 180) return result - 360;
  if (result < -180) return result + 360;
  return result;
}

function result(state) {
  return {
    lat: Number(state.lat.toFixed(7)), lng: Number(state.lng.toFixed(7)),
    vLat: state.vLat, vLng: state.vLng, speedMps: Number(state.speedMps.toFixed(2)),
  };
}

/** Scalar position smoothing with a displacement-derived velocity estimate, not a full covariance kinematic model. */
export class KalmanFilter2D {
  #state = null;
  #r;
  #q;

  constructor(options = {}) {
    this.#r = finite(options.measurementNoise ?? 4, 'measurement noise');
    this.#q = finite(options.processNoise ?? 1.5, 'process noise');
    if (this.#r <= 0 || this.#r > MAX_NOISE_VARIANCE || this.#q < 0 || this.#q > MAX_NOISE_VARIANCE) {
      throw new RangeError('noise variances must be bounded; measurement positive and process nonnegative');
    }
  }

  // Preserve readable legacy fields while keeping one privately owned state receipt.
  get r() { return this.#r; }
  get q() { return this.#q; }
  get lat() { return this.#state?.lat ?? null; }
  get lng() { return this.#state?.lng ?? null; }
  get vLat() { return this.#state?.vLat ?? 0; }
  get vLng() { return this.#state?.vLng ?? 0; }
  get pLat() { return this.#state?.pLat ?? 1; }
  get pLng() { return this.#state?.pLng ?? 1; }
  get lastTimestamp() { return this.#state?.input.timestamp ?? null; }

  /** Explicitly reset only after completely admitting a new starting observation. */
  init(lat, lng, timestamp = Date.now(), accuracy = 4) {
    const input = observation(lat, lng, timestamp, accuracy);
    this.#state = Object.freeze({ lat, lng, vLat: 0, vLng: 0, pLat: 1, pLng: 1, speedMps: 0, input });
  }

  /** Prepare and admit an entire candidate before publishing any state or time. */
  update(zLat, zLng, timestamp = Date.now(), accuracy = 4) {
    const input = observation(zLat, zLng, timestamp, accuracy);
    if (!this.#state) {
      this.init(zLat, zLng, timestamp, accuracy);
      return result(this.#state);
    }
    const previous = this.#state;
    if (timestamp < previous.input.timestamp) throw new RangeError('observation time must not move backwards');
    if (timestamp === previous.input.timestamp) {
      if (zLat !== previous.input.lat || zLng !== previous.input.lng || accuracy !== previous.input.accuracy) {
        throw new RangeError('conflicting observations at the same timestamp');
      }
      return result(previous);
    }

    const dt = (timestamp - previous.input.timestamp) / 1000;
    const travelLng = previous.vLng * dt;
    if (Math.abs(travelLng) >= 180) throw new RangeError('ambiguous longitude prediction; explicitly reinitialize');
    const predLat = previous.lat + previous.vLat * dt;
    const predLng = wrappedDegrees(previous.lng + travelLng);
    const residualLng = wrappedDegrees(zLng - predLng);
    if (Math.abs(residualLng) === 180) throw new RangeError('antipodal longitude observation is ambiguous');
    // P, R are local metre-squared variances; Q is metre-squared per second.
    // Scaling both P and R to either angular axis cancels in the dimensionless gain.
    const varianceR = Math.max(this.#r, (accuracy / 2) ** 2);
    const predPLat = previous.pLat + this.#q * dt;
    const predPLng = previous.pLng + this.#q * dt;
    const kLat = predPLat / (predPLat + varianceR);
    const kLng = predPLng / (predPLng + varianceR);
    const lat = predLat + kLat * (zLat - predLat);
    const lng = wrappedDegrees(predLng + kLng * residualLng);
    const vLat = (lat - previous.lat) / dt;
    const vLng = wrappedDegrees(lng - previous.lng) / dt;
    const pLat = (1 - kLat) * predPLat;
    const pLng = (1 - kLng) * predPLng;
    const speedMps = Math.hypot(vLat * METERS_PER_DEGREE, vLng * METERS_PER_DEGREE * Math.cos(lat * Math.PI / 180));
    const candidate = { lat, lng, vLat, vLng, pLat, pLng, speedMps, input };
    for (const [key, value] of Object.entries(candidate)) {
      if (key !== 'input') finite(value, `candidate ${key}`);
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || pLat < 0 || pLng < 0) {
      throw new RangeError('candidate state is outside the geographic/covariance domain');
    }
    this.#state = Object.freeze(candidate);
    return result(this.#state);
  }
}

export default KalmanFilter2D;
