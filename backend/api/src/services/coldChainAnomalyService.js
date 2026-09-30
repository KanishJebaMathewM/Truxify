import logger from '../middleware/logger.js';
import { supabaseAdmin, redisClient } from '../config/db.js';
import { sendPushNotification } from './notificationService.js';
import { measureExecution } from '../core/performanceMetrics.js';

// Standard activation energy constant for spoilage degradation kinetics (deltaH / R in Kelvin)
const DELTA_H_OVER_R = 10000;
const SLIDING_WINDOW_MAX_ENTRIES = 120; // 2 hours of 1-minute samples
const MAX_CONSECUTIVE_BREACH_SAMPLES = 5; // 5 consecutive out-of-range samples triggers immediate breach
const ESCROW_HOLD_TTL_SECONDS = 86400 * 3; // 3 days hold

/**
 * Calculate Mean Kinetic Temperature (MKT) in Celsius from a series of Celsius readings.
 * MKT accounts for logarithmic degradation acceleration under thermal stress.
 *
 * @param {number[]} temperatures - Array of temperature readings in Celsius
 * @returns {number|null} MKT in Celsius, or null if insufficient data
 */
export function calculateMeanKineticTemperature(temperatures) {
  if (!Array.isArray(temperatures) || temperatures.length === 0) return null;

  let sumExp = 0;
  let validCount = 0;

  for (const t of temperatures) {
    if (!Number.isFinite(t)) continue;
    const tempKelvin = t + 273.15;
    if (tempKelvin <= 0) continue;
    sumExp += Math.exp(-DELTA_H_OVER_R / tempKelvin);
    validCount++;
  }

  if (validCount === 0 || sumExp === 0) return null;

  const avgExp = sumExp / validCount;
  const mktKelvin = DELTA_H_OVER_R / -Math.log(avgExp);
  const mktCelsius = mktKelvin - 273.15;

  return Number(mktCelsius.toFixed(2));
}

class ColdChainAnomalyService {
  /**
   * Ingest a batch or single telemetry reading, evaluate sliding-window MKT,
   * and execute automated SLA breach mitigation if excursions are detected.
   *
   * @param {object} params
   * @param {string} params.loadId
   * @param {string} [params.orderId]
   * @param {number|number[]} params.temperature - Single reading or array of readings
   * @param {number|null} params.targetMin - Minimum target Celsius
   * @param {number|null} params.targetMax - Maximum target Celsius
   * @param {string} [params.customerId]
   * @param {string} [params.driverId]
   * @returns {Promise<object>} Analysis result with breach status and MKT
   */
  async processTelemetry({
    loadId,
    orderId,
    temperature,
    targetMin,
    targetMax,
    customerId,
    driverId,
  }) {
    return measureExecution('ColdChainAnomalyService.processTelemetry', async () => {
      const readings = Array.isArray(temperature) ? temperature : [temperature];
      const validReadings = readings.map(Number).filter(Number.isFinite);

      if (validReadings.length === 0) {
        return { success: false, error: 'No valid numeric temperature readings provided' };
      }

      const windowKey = `coldchain:window:${loadId}`;
      let windowTemperatures;

      // 1. Maintain sliding window in Redis (or local memory)
      if (redisClient) {
        try {
          const pipeline = redisClient.pipeline();
          for (const t of validReadings) {
            pipeline.rpush(windowKey, JSON.stringify({ t, timestamp: Date.now() }));
          }
          pipeline.ltrim(windowKey, -SLIDING_WINDOW_MAX_ENTRIES, -1);
          pipeline.expire(windowKey, 86400); // 24h retention
          pipeline.lrange(windowKey, 0, -1);
          const results = await pipeline.exec();
          const rawEntries = results[results.length - 1]?.[1] || [];
          windowTemperatures = rawEntries
            .map((e) => {
              try {
                return JSON.parse(e).t;
              } catch {
                return null;
              }
            })
            .filter(Number.isFinite);
        } catch (redisErr) {
          logger.warn({ err: redisErr }, '[ColdChain] Redis sliding window error — evaluating locally');
          windowTemperatures = validReadings;
        }
      } else {
        windowTemperatures = validReadings;
      }

      // 2. Compute Mean Kinetic Temperature
      const mkt = calculateMeanKineticTemperature(windowTemperatures);
      const latestTemp = validReadings[validReadings.length - 1];

      // 3. Evaluate Breach Conditions
      let isBreach = false;
      let breachReason = null;

      const hasMinConstraint = targetMin !== null && Number.isFinite(targetMin);
      const hasMaxConstraint = targetMax !== null && Number.isFinite(targetMax);

      if (hasMaxConstraint && latestTemp > targetMax) {
        // Count consecutive tail breaches in window
        let consecutiveHighs = 0;
        for (let i = windowTemperatures.length - 1; i >= 0; i--) {
          if (windowTemperatures[i] > targetMax) consecutiveHighs++;
          else break;
        }
        if (consecutiveHighs >= MAX_CONSECUTIVE_BREACH_SAMPLES) {
          isBreach = true;
          breachReason = `Temperature exceeded max threshold (${targetMax}°C) for ${consecutiveHighs} consecutive readings. Current: ${latestTemp}°C.`;
        }
      }

      if (!isBreach && hasMinConstraint && latestTemp < targetMin) {
        let consecutiveLows = 0;
        for (let i = windowTemperatures.length - 1; i >= 0; i--) {
          if (windowTemperatures[i] < targetMin) consecutiveLows++;
          else break;
        }
        if (consecutiveLows >= MAX_CONSECUTIVE_BREACH_SAMPLES) {
          isBreach = true;
          breachReason = `Temperature dropped below min threshold (${targetMin}°C) for ${consecutiveLows} consecutive readings. Current: ${latestTemp}°C.`;
        }
      }

      // MKT overall degradation check
      if (!isBreach && mkt !== null) {
        if (hasMaxConstraint && mkt > targetMax + 2.0) {
          isBreach = true;
          breachReason = `Cumulative Mean Kinetic Temperature (MKT: ${mkt}°C) exceeded safe shelf-life threshold (${targetMax}°C).`;
        }
      }

      // 4. Trigger Automatic SLA Mitigation on Breach
      if (isBreach) {
        await this.handleSlaBreach({
          loadId,
          orderId,
          latestTemp,
          mkt,
          breachReason,
          customerId,
          driverId,
        });
      }

      return {
        success: true,
        loadId,
        latestTemp,
        mkt,
        isBreach,
        breachReason,
        windowSize: windowTemperatures.length,
      };
    });
  }

  /**
   * Execute automated SLA breach workflow: audit logging, escrow hold, and FCM notification.
   */
  async handleSlaBreach({ loadId, orderId, latestTemp, mkt, breachReason, customerId, driverId }) {
    logger.error(`[ColdChain SLA Breach] Load ${loadId} (Order ${orderId || 'N/A'}): ${breachReason}`);

    const breachPayload = {
      event: 'COLD_CHAIN_SLA_BREACH',
      loadId,
      orderId,
      latestTemp,
      mkt,
      reason: breachReason,
      timestamp: new Date().toISOString(),
    };

    // 1. Immutable Audit Logging
    if (supabaseAdmin) {
      try {
        await supabaseAdmin.from('application_audit_logs').insert({
          action: 'COLD_CHAIN_SLA_BREACH',
          entity_type: 'load_offer',
          entity_id: loadId,
          payload: breachPayload,
          created_at: new Date().toISOString(),
        });
      } catch (dbErr) {
        logger.error({ err: dbErr }, '[ColdChain] Failed to write audit log');
      }
    }

    // 2. Escrow Hold Placement
    if (orderId) {
      if (redisClient) {
        try {
          await redisClient.set(`escrow:hold:${orderId}`, JSON.stringify(breachPayload), 'EX', ESCROW_HOLD_TTL_SECONDS);
          logger.info(`[ColdChain] Escrow release hold placed on Order ${orderId}`);
        } catch (redisErr) {
          logger.error({ err: redisErr }, '[ColdChain] Failed to set escrow hold in Redis');
        }
      }

      if (supabaseAdmin) {
        try {
          await supabaseAdmin
            .from('orders')
            .update({
              status: 'disputed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', orderId)
            .in('status', ['in_transit', 'picked_up', 'arriving']);
        } catch (orderUpdateErr) {
          logger.error({ err: orderUpdateErr }, '[ColdChain] Failed to flag order as disputed');
        }
      }
    }

    // 3. Dispatch High-Priority Alert to Customer & Fleet
    if (customerId) {
      try {
        await sendPushNotification(
          customerId,
          '⚠️ Cold-Chain SLA Breach Alert',
          `Thermal excursion detected on Load ${loadId}. MKT: ${mkt ?? latestTemp}°C. Escrow auto-release paused.`,
          'system',
          { load_id: loadId, order_id: orderId, cold_chain_breach: true }
        );
      } catch (notifErr) {
        logger.error({ err: notifErr }, '[ColdChain] Failed to notify customer');
      }
    }
  }
}

export const coldChainAnomalyService = new ColdChainAnomalyService();
export default coldChainAnomalyService;
