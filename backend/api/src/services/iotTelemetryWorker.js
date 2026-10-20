/**
 * @fileoverview High-Throughput IoT Telemetry Worker & Buffer Manager for Cold-Chain Integrity.
 * 
 * Responsibilities:
 * 1. Ingests raw BLE/cellular sensor telemetry (temperature, humidity, shock, reed door switches).
 * 2. Manages sliding window telemetry buffers for active perishable freight shipments.
 * 3. Evaluates thermal kinetic degradation (MKT), impact shocks, and unauthorized door openings.
 * 4. Dispatches telemetry to FastAPI ML service and triggers smart contract SLA adjustments.
 */

import axios from 'axios';
import logger from '../middleware/logger.js';
import { DomainError } from './order/domainError.js';
import { calculateMeanKineticTemperature } from './coldChainAnomalyService.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_API_KEY = process.env.ML_API_KEY || 'truxify-ml-secret-api-key-2026';
const MAX_WINDOW_SAMPLES = 120; // 2 hours of 1-sample/min

// In-memory sliding telemetry buffers by loadId / bookingId
const activeTelemetryBuffers = new Map();
const activeSlaConfigurations = new Map();

/**
 * Registers an SLA configuration for an active perishable shipment.
 */
export function registerCargoSLA(loadId, slaConfig) {
  const {
    bookingId,
    minTempCelsius = 2.0,
    maxTempCelsius = 8.0,
    maxExcursionMinutes = 45,
    maxShockG = 3.5,
    penaltyBasisPoints = 2500,
  } = slaConfig;

  activeSlaConfigurations.set(loadId, {
    loadId,
    bookingId: bookingId || loadId,
    minTempCelsius: Number(minTempCelsius),
    maxTempCelsius: Number(maxTempCelsius),
    maxExcursionMinutes: Number(maxExcursionMinutes),
    maxShockG: Number(maxShockG),
    penaltyBasisPoints: Number(penaltyBasisPoints),
    registeredAt: new Date().toISOString(),
  });

  if (!activeTelemetryBuffers.has(loadId)) {
    activeTelemetryBuffers.set(loadId, []);
  }

  logger.info({ loadId, minTempCelsius, maxTempCelsius }, '[iotTelemetryWorker] Perishable cargo SLA registered');
}

/**
 * Ingests a raw sensor telemetry frame from BLE beacon or cellular gateway.
 * 
 * @param {Object} frame - Sensor telemetry payload
 * @returns {Object} Processing outcome, latest MKT, and breach status
 */
export async function ingestTelemetryFrame(frame) {
  const {
    loadId,
    sensorId,
    temperatureCelsius,
    relativeHumidityPct = null,
    shockVibrationG = 0,
    doorOpen = false,
    lat = null,
    lng = null,
    batteryPct = null,
    timestamp = Date.now(),
  } = frame;

  if (!loadId || temperatureCelsius == null || !Number.isFinite(Number(temperatureCelsius))) {
    throw new DomainError(400, { error: 'Valid loadId and numeric temperatureCelsius are required' });
  }

  const sample = {
    sensorId: sensorId || 'SENSOR_DEFAULT',
    temperature: Number(temperatureCelsius),
    humidity: relativeHumidityPct != null ? Number(relativeHumidityPct) : null,
    shockG: Number(shockVibrationG) || 0,
    doorOpen: Boolean(doorOpen),
    lat: lat != null ? Number(lat) : null,
    lng: lng != null ? Number(lng) : null,
    batteryPct: batteryPct != null ? Number(batteryPct) : null,
    timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
  };

  if (!activeTelemetryBuffers.has(loadId)) {
    activeTelemetryBuffers.set(loadId, []);
  }

  const buffer = activeTelemetryBuffers.get(loadId);
  buffer.push(sample);

  // Maintain sliding window length
  if (buffer.length > MAX_WINDOW_SAMPLES) {
    buffer.shift();
  }

  // Retrieve SLA criteria
  const sla = activeSlaConfigurations.get(loadId) || {
    minTempCelsius: 2.0,
    maxTempCelsius: 8.0,
    maxExcursionMinutes: 45,
    maxShockG: 3.5,
  };

  // Evaluate sliding window analytics
  const temperatures = buffer.map((s) => s.temperature);
  const shocks = buffer.map((s) => s.shockG);
  const doorOpenCount = buffer.filter((s) => s.doorOpen).length;

  const currentMkt = calculateMeanKineticTemperature(temperatures);

  // Check excursions
  const excursionCount = temperatures.filter(
    (t) => t < sla.minTempCelsius || t > sla.maxTempCelsius
  ).length;

  const peakShock = shocks.length > 0 ? Math.max(...shocks) : 0;
  const isTempBreach = excursionCount > sla.maxExcursionMinutes;
  const isShockBreach = peakShock > sla.maxShockG;
  const isCriticalBreach = isTempBreach || isShockBreach;

  const analysis = {
    loadId,
    latestReading: sample,
    windowSampleCount: buffer.length,
    currentMktCelsius: currentMkt,
    excursionMinutes: excursionCount,
    maxAllowedExcursionMins: sla.maxExcursionMinutes,
    peakShockG: Number(peakShock.toFixed(2)),
    doorOpenEventsInWindow: doorOpenCount,
    slaStatus: isCriticalBreach ? 'CRITICAL_BREACH' : excursionCount > 0 ? 'WARNING' : 'COMPLIANT',
    isCriticalBreach,
  };

  if (isCriticalBreach) {
    logger.warn(
      { loadId, excursionCount, peakShock, slaStatus: analysis.slaStatus },
      '[iotTelemetryWorker] Critical cold-chain SLA breach detected'
    );
  }

  return analysis;
}

/**
 * Invokes FastAPI ML engine for advanced deep degradation modeling.
 */
export async function evaluateViaMlService(loadId) {
  const buffer = activeTelemetryBuffers.get(loadId) || [];
  const sla = activeSlaConfigurations.get(loadId) || {
    minTempCelsius: 2.0,
    maxTempCelsius: 8.0,
    maxExcursionMinutes: 45,
  };

  if (buffer.length === 0) {
    throw new DomainError(404, { error: 'No telemetry buffer data available for this load' });
  }

  const temperatures = buffer.map((s) => s.temperature);
  const shocks = buffer.map((s) => s.shockG);
  const doorOpenEvents = buffer.filter((s) => s.doorOpen).length;

  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/coldchain/evaluate`,
      {
        load_id: loadId,
        temperatures_celsius: temperatures,
        min_temp_celsius: sla.minTempCelsius,
        max_temp_celsius: sla.maxTempCelsius,
        shock_readings_g: shocks,
        door_open_events: doorOpenEvents,
        max_allowed_excursion_mins: sla.maxExcursionMinutes,
      },
      {
        headers: {
          'X-API-Key': ML_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 4000,
      }
    );

    return response.data?.data || response.data;
  } catch (err) {
    logger.warn(
      { error: err.message, loadId },
      '[iotTelemetryWorker] ML service request failed, evaluating locally'
    );

    const mkt = calculateMeanKineticTemperature(temperatures);
    return {
      status: 'EVALUATED_LOCALLY',
      mkt_celsius: mkt,
      latest_temp_celsius: temperatures[temperatures.length - 1],
      sample_count: temperatures.length,
    };
  }
}

/**
 * Retrieves the full telemetry window for an active load.
 */
export function getLoadTelemetryHistory(loadId) {
  return activeTelemetryBuffers.get(loadId) || [];
}

export default {
  registerCargoSLA,
  ingestTelemetryFrame,
  evaluateViaMlService,
  getLoadTelemetryHistory,
};
