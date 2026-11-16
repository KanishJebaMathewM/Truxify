import { KalmanFilter2D } from './kalmanFilter.js';
import { GeofenceEvaluator } from './geofenceEvaluator.js';
import { admitStreamPing, streamPolicy, admittedSmoothed } from './gpsStreamObservation.js';

export const GPS_STREAM_KEY = 'gps:stream:trips';
export const GPS_STREAM_GROUP = 'gps_workers_group';
const copy = (value) => structuredClone(value);

export class GpsStreamIngestionService {
  #policy;
  #records = new Map();
  #client;
  #groupFlight = null;
  constructor(options = {}) {
    this.#policy = streamPolicy(options);
    this.#client = options.redisClient;
    this.geofenceEvaluator = options.geofenceEvaluator ?? new GeofenceEvaluator();
    if (typeof this.geofenceEvaluator?.evaluateLocation !== 'function' ||
        typeof this.geofenceEvaluator?.clearTrip !== 'function') throw new TypeError('Invalid GPS evaluator');
  }
  get streamKey() { return this.#policy.streamKey; }
  // Observation snapshots do not expose mutable filter instances.
  get kalmanFilters() { return new Map([...this.#records].map(([id, record]) => [id, copy(record.receipt?.smoothed ?? null)])); }
  async #redis() {
    if (this.#client === undefined) return (await import('../../config/db.js')).redisClient;
    return this.#client;
  }
  async #initializeGroup() {
    try {
      const client = await this.#redis();
      if (typeof client?.xgroup !== 'function') return {success: false, reason: 'redis_unavailable'};
      const response = await client.xgroup('CREATE', this.streamKey, GPS_STREAM_GROUP, '$', 'MKSTREAM');
      return response === 'OK' ? {success: true, created: true} : {success: false, reason: 'invalid_acknowledgement'};
    } catch (error) {
      if (error?.message?.startsWith('BUSYGROUP ')) return {success: true, created: false};
      return {success: false, reason: 'redis_unavailable'};
    }
  }
  initStreamGroup() {
    const flight = this.#groupFlight ?? this.#initializeGroup();
    this.#groupFlight = flight;
    flight.then(() => { if (this.#groupFlight === flight) this.#groupFlight = null; });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({success: false, reason: 'acknowledgement_pending'}),
        this.#policy.acknowledgementTimeoutMs);
      flight.then((result) => { clearTimeout(timer); resolve(result); });
    });
  }
  #result(record, reason) {
    return {...copy(record.receipt), success: record.streamId !== null,
      persisted: record.streamId !== null, streamId: record.streamId,
      deliveryReason: record.streamId !== null ? 'acknowledged' : reason};
  }
  #wait(record, flight) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.#result(record, 'acknowledgement_pending')),
        this.#policy.acknowledgementTimeoutMs);
      flight.then((reason) => { clearTimeout(timer); resolve(this.#result(record, reason)); });
    });
  }
  #publish(record) {
    // Retain ownership until the underlying command settles, even after the caller's wait expires.
    const flight = (async () => {
      try {
        const client = await this.#redis();
        if (typeof client?.xadd !== 'function') return 'redis_unavailable';
        const streamId = await client.xadd(this.streamKey, 'MAXLEN', '~',
          this.#policy.maxStreamEntries, '*', ...record.entries);
        if (typeof streamId !== 'string' || !/^\d+-\d+$/.test(streamId)) return 'invalid_acknowledgement';
        record.streamId = streamId;
        return 'acknowledged';
      } catch { return 'redis_unavailable'; }
    })();
    record.flight = flight;
    flight.then(() => { if (record.flight === flight) record.flight = null; });
    return this.#wait(record, flight);
  }
  ingestPing(input) {
    const ping = admitStreamPing(input);
    const fingerprint = JSON.stringify(ping);
    let record = this.#records.get(ping.tripId);
    if (record) {
      if (record.faulted) throw new Error('GPS local transition failed; clearTrip is required');
      if (record.fingerprint === fingerprint) {
        if (record.streamId !== null) return Promise.resolve(this.#result(record, 'acknowledged'));
        if (record.flight) return this.#wait(record, record.flight);
        return this.#publish(record);
      }
      if (record.streamId === null) throw new Error('GPS previous observation is not acknowledged; retry it first');
      if (ping.timestamp <= record.timestamp) throw new Error('GPS observation timestamp must advance');
    } else {
      if (this.#records.size >= this.#policy.maxTrips) throw new Error('GPS retained trip capacity exceeded');
      record = {filter: new KalmanFilter2D(), receipt: null};
      this.#records.set(ping.tripId, record);
    }
    try {
      const smoothed = admittedSmoothed(record.filter.update(ping.lat, ping.lng, ping.timestamp, ping.accuracy));
      const geofenceEvents = copy(this.geofenceEvaluator.evaluateLocation(ping.tripId, smoothed.lat, smoothed.lng));
      if (!Array.isArray(geofenceEvents) || geofenceEvents.length > 10000) throw new Error('Invalid GPS geofence receipt');
      const eventText = JSON.stringify(geofenceEvents);
      if (Buffer.byteLength(eventText) > 1024 * 1024) throw new Error('GPS geofence receipt too large');
      record.receipt = {tripId: ping.tripId, observation: copy(ping), smoothed, geofenceEvents, timestamp: new Date(ping.timestamp).toISOString()};
      record.entries = Object.entries({tripId: String(ping.tripId), driverId: String(ping.driverId),
        rawLat: String(ping.lat), rawLng: String(ping.lng), lat: String(smoothed.lat), lng: String(smoothed.lng),
        speed: String(smoothed.speedMps), heading: String(ping.heading), accuracy: String(ping.accuracy),
        timestamp: String(ping.timestamp), geofenceEvents: eventText}).flat();
      record.fingerprint = fingerprint;
      record.timestamp = ping.timestamp;
      record.streamId = null;
      record.faulted = false;
    } catch (error) {
      // Collaborator mutations cannot be rolled back: fence this trip until explicit cleanup.
      record.faulted = true;
      throw error;
    }
    return this.#publish(record);
  }
  clearTrip(tripId) {
    const record = this.#records.get(tripId);
    if (record && (record.flight || (!record.faulted && record.streamId === null))) {
      throw new Error('GPS pending observation cannot be discarded');
    }
    this.geofenceEvaluator.clearTrip(tripId);
    return this.#records.delete(tripId);
  }
}
export default GpsStreamIngestionService;
