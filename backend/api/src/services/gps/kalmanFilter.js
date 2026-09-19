/**
 * KalmanFilter: 2D Kinematic Kalman Filter for GPS Trajectory Smoothing
 * 
 * Tracks position [lat, lng] and velocity [v_lat, v_lng] to remove GPS sensor noise,
 * jitter, and multipath reflection drift.
 */
export class KalmanFilter2D {
  /**
   * @param {object} [options={}]
   * @param {number} [options.measurementNoise=4.0] - Measurement noise variance R (meters^2)
   * @param {number} [options.processNoise=1.5] - Process noise variance Q
   */
  constructor(options = {}) {
    this.r = options.measurementNoise || 4.0;
    this.q = options.processNoise || 1.5;

    this.lat = null;
    this.lng = null;
    this.vLat = 0;
    this.vLng = 0;
    this.pLat = 1.0;
    this.pLng = 1.0;
    this.lastTimestamp = null;
  }

  /**
   * Initializes or resets the filter with a starting GPS coordinate.
   * @param {number} lat
   * @param {number} lng
   * @param {number} [timestamp=Date.now()]
   */
  init(lat, lng, timestamp = Date.now()) {
    this.lat = lat;
    this.lng = lng;
    this.vLat = 0;
    this.vLng = 0;
    this.pLat = 1.0;
    this.pLng = 1.0;
    this.lastTimestamp = timestamp;
  }

  /**
   * Updates state estimate with a new raw GPS observation.
   * 
   * @param {number} zLat - Observed latitude
   * @param {number} zLng - Observed longitude
   * @param {number} [timestamp=Date.now()] - Measurement timestamp in ms
   * @param {number} [accuracy=4.0] - Reported GPS accuracy in meters
   * @returns {{lat: number, lng: number, vLat: number, vLng: number, speedMps: number}}
   */
  update(zLat, zLng, timestamp = Date.now(), accuracy = 4.0) {
    if (this.lat === null || this.lng === null || this.lastTimestamp === null) {
      this.init(zLat, zLng, timestamp);
      return { lat: zLat, lng: zLng, vLat: 0, vLng: 0, speedMps: 0 };
    }

    const dt = Math.max(0.1, (timestamp - this.lastTimestamp) / 1000.0); // Elapsed seconds
    this.lastTimestamp = timestamp;

    // Measurement noise dynamically scaled by sensor reported accuracy
    const varianceR = Math.max(1.0, (accuracy / 2.0) ** 2);

    // --- 1. Predict Step ---
    // Project state ahead: x_k = x_{k-1} + v * dt
    const predLat = this.lat + this.vLat * dt;
    const predLng = this.lng + this.vLng * dt;

    // Project error covariance ahead: P_k = P_{k-1} + Q * dt
    const predPLat = this.pLat + this.q * dt;
    const predPLng = this.pLng + this.q * dt;

    // --- 2. Update Step ---
    // Kalman gain: K = P / (P + R)
    const kLat = predPLat / (predPLat + varianceR);
    const kLng = predPLng / (predPLng + varianceR);

    // State update with measurement residual
    const newLat = predLat + kLat * (zLat - predLat);
    const newLng = predLng + kLng * (zLng - predLng);

    // Update estimated velocity
    this.vLat = (newLat - this.lat) / dt;
    this.vLng = (newLng - this.lng) / dt;

    // Update state covariance: P = (1 - K) * P
    this.pLat = (1 - kLat) * predPLat;
    this.pLng = (1 - kLng) * predPLng;

    this.lat = newLat;
    this.lng = newLng;

    // Approximate ground speed in m/s (1 deg latitude ~ 111,320m)
    const dyMeters = (this.vLat * 111320);
    const dxMeters = (this.vLng * 111320 * Math.cos((this.lat * Math.PI) / 180.0));
    const speedMps = Math.sqrt(dxMeters ** 2 + dyMeters ** 2);

    return {
      lat: Number(newLat.toFixed(7)),
      lng: Number(newLng.toFixed(7)),
      vLat: this.vLat,
      vLng: this.vLng,
      speedMps: Number(speedMps.toFixed(2)),
    };
  }
}

export default KalmanFilter2D;
