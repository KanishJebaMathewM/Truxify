import zlib from 'zlib';
import logger from '../../middleware/logger.js';
import { SlidingWindowAggregator } from './slidingWindowAggregator.js';
import { IncidentAlertService } from './incidentAlertService.js';

export const CARGO_PROFILES = Object.freeze({
  AMBIENT: { minTemp: 15.0, maxTemp: 25.0, maxHumidity: 70.0, label: 'Ambient Standard' },
  CHILLED: { minTemp: 0.0, maxTemp: 4.0, maxHumidity: 90.0, label: 'Chilled Dairy/Produce' },
  FROZEN: { minTemp: -25.0, maxTemp: -18.0, maxHumidity: 85.0, label: 'Deep Frozen Meat/Ice Cream' },
  PHARMA: { minTemp: 2.0, maxTemp: 8.0, maxHumidity: 60.0, label: 'Pharmaceuticals & Vaccines' },
});

export class TelematicsIngestionService {
  /**
   * @param {object} [options={}]
   */
  constructor(options = {}) {
    this.aggregator = new SlidingWindowAggregator(options);
    this.alertService = new IncidentAlertService(options);
  }

  /**
   * Decodes and parses raw incoming telemetry payload (supports JSON or gzip compressed buffer).
   * 
   * @param {Buffer|string|object} rawPayload
   * @param {string} [contentType='application/json']
   * @returns {object} Parsed telemetry frame
   */
  parsePayload(rawPayload, contentType = 'application/json') {
    try {
      if (Buffer.isBuffer(rawPayload)) {
        // Check for gzip magic header (0x1f 0x8b)
        if (rawPayload[0] === 0x1f && rawPayload[1] === 0x8b) {
          const unzipped = zlib.gunzipSync(rawPayload);
          return JSON.parse(unzipped.toString('utf-8'));
        }
        return JSON.parse(rawPayload.toString('utf-8'));
      }

      if (typeof rawPayload === 'string') {
        return JSON.parse(rawPayload);
      }

      return rawPayload;
    } catch (err) {
      throw new Error(`Failed to parse IoT telemetry payload: ${err.message}`);
    }
  }

  /**
   * Ingests a telemetry packet, updates sliding window, and evaluates anomalies.
   * 
   * @param {object|Buffer} payload - Telemetry packet
   * @param {object} [context={}] - Cargo context (cargoProfile, driverId, shipperId)
   * @returns {Promise<object>} Ingestion result with window stats and anomaly evaluation
   */
  async ingestTelemetry(payload, context = {}) {
    const data = this.parsePayload(payload);
    const tripId = data.trip_id || data.tripId;

    if (!tripId) {
      throw new Error('Missing trip_id in telemetry packet');
    }

    const reading = {
      temp: data.temp ?? data.temperature,
      humidity: data.humidity,
      doorOpen: data.door_open ?? data.doorOpen,
      ax: data.ax,
      ay: data.ay,
      az: data.az,
      timestamp: data.timestamp || new Date().toISOString(),
    };

    // 1. Ingest into 5-minute sliding window aggregator
    const windowSummary = this.aggregator.addReading(tripId, reading);

    // 2. Identify Cargo Profile
    const profileKey = (context.cargoProfile || data.cargo_profile || 'AMBIENT').toUpperCase();
    const cargoProfile = CARGO_PROFILES[profileKey] || CARGO_PROFILES.AMBIENT;

    // 3. Rule-Based Cold-Chain & Shock Anomaly Evaluation
    const anomalyResult = this._evaluateAnomalies(tripId, windowSummary, cargoProfile, context);

    // 4. Trigger Alerts & Audit Logs if anomalies found
    if (anomalyResult.hasAnomaly) {
      await this.alertService.handleIncident(tripId, anomalyResult, windowSummary, context);
    }

    return {
      success: true,
      tripId,
      windowSummary,
      anomalyResult,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Evaluates window metrics against cargo profile SLA and kinematic safety limits.
   * 
   * @private
   */
  _evaluateAnomalies(tripId, summary, profile, context) {
    const violations = [];
    let severity = 'NONE';

    // A. Temperature Excursion Check
    if (summary.tempMax > profile.maxTemp) {
      const excursion = Number((summary.tempMax - profile.maxTemp).toFixed(2));
      violations.push({
        type: 'TEMP_HIGH_EXCURSION',
        message: `Temperature reached ${summary.tempMax}°C exceeding max allowed ${profile.maxTemp}°C (+${excursion}°C)`,
        severity: excursion > 4.0 ? 'CRITICAL' : 'MEDIUM',
      });
    }

    if (summary.tempMin < profile.minTemp) {
      const excursion = Number((profile.minTemp - summary.tempMin).toFixed(2));
      violations.push({
        type: 'TEMP_LOW_EXCURSION',
        message: `Temperature dropped to ${summary.tempMin}°C below min allowed ${profile.minTemp}°C (-${excursion}°C)`,
        severity: excursion > 4.0 ? 'CRITICAL' : 'MEDIUM',
      });
    }

    // B. Sensor Tampering / Probe Disconnect (Zero variance over >15 readings)
    if (summary.readingCount >= 15 && summary.tempStdDev === 0) {
      violations.push({
        type: 'SENSOR_TAMPER_SUSPECTED',
        message: `Zero temperature variance detected over ${summary.readingCount} readings; probe may be frozen, disconnected or spoofed`,
        severity: 'HIGH',
      });
    }

    // C. Kinematic Shock / Dangerous Driving
    if (summary.peakShockMps2 >= 15.0) {
      violations.push({
        type: 'SEVERE_CARGO_SHOCK',
        message: `High impact shock detected: ${summary.peakShockMps2} m/s² (${summary.peakShockG}g)`,
        severity: 'CRITICAL',
      });
    } else if (summary.harshBrakingCount >= 3) {
      violations.push({
        type: 'HARSH_DRIVING_PATTERN',
        message: `${summary.harshBrakingCount} harsh braking/cornering events detected in 5-minute window`,
        severity: 'MEDIUM',
      });
    }

    // D. Unauthorized Door Breach in Transit
    if (summary.doorOpenSeconds > 60 && context.tripStatus === 'IN_TRANSIT') {
      violations.push({
        type: 'UNAUTHORIZED_DOOR_OPEN',
        message: `Cargo door remained open for ${summary.doorOpenSeconds}s while vehicle was in transit`,
        severity: 'HIGH',
      });
    }

    if (violations.some((v) => v.severity === 'CRITICAL')) {
      severity = 'CRITICAL';
    } else if (violations.some((v) => v.severity === 'HIGH')) {
      severity = 'HIGH';
    } else if (violations.length > 0) {
      severity = 'MEDIUM';
    }

    return {
      hasAnomaly: violations.length > 0,
      severity,
      violations,
      cargoProfile: profile.label,
    };
  }
}

export default TelematicsIngestionService;
