import logger from '../middleware/logger.js';

export const MAX_RETAINED_TIRE_REPORTS = 1000;
export const TIRE_REPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UNOWNED_OWNER_KEY = '__unowned__';

function reportKey(ownerId, truckId) {
  return `${ownerId ?? UNOWNED_OWNER_KEY}:${truckId}`;
}

/**
 * Service for predictive tire wear analytics and TPMS monitoring.
 */
class TireAnalyticsService {
  constructor() {
    this.truckTireReports = new Map();
  }

  pruneExpiredReports(now = Date.now()) {
    let removed = 0;
    for (const [key, report] of this.truckTireReports) {
      const evaluatedAt = Date.parse(report.evaluatedAt);
      if (!Number.isFinite(evaluatedAt) || now - evaluatedAt > TIRE_REPORT_TTL_MS) {
        this.truckTireReports.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clearReports() {
    this.truckTireReports.clear();
  }

  getReportCount() {
    return this.truckTireReports.size;
  }

  /**
   * Analyzes TPMS telemetry readings to predict tire wear and blowout risks.
   * @param {Object} params
   * @param {string} params.truckId
   * @param {Array<Object>} params.tpmsReadings - [{ position: 'FL', pressurePsi: 110, tempC: 42, mileageKm: 45000 }]
   * @returns {Object} Comprehensive tire health and wear prediction report
   */
  async analyzeTireHealth({ ownerId, truckId, tpmsReadings }) {
    if (!Array.isArray(tpmsReadings) || tpmsReadings.length === 0) {
      throw new Error('Invalid or empty TPMS readings provided');
    }

    const analyzedTires = tpmsReadings.map((reading) => {
      const { position, pressurePsi, tempC, mileageKm = 0 } = reading;
      
      // Standard target PSI is ~100-110 for heavy trucks
      const pressureDev = Math.abs(pressurePsi - 105);
      const tempDev = tempC > 65 ? (tempC - 65) : 0;
      
      // Estimated wear calculation
      const wearPercent = Math.min(100, Number(((mileageKm / 120000) * 100 + pressureDev * 0.5 + tempDev * 1.2).toFixed(1)));
      const remainingLifeKm = Math.max(0, Math.round((100 - wearPercent) * 1200));

      let alertLevel = 'NORMAL';
      if (wearPercent > 85 || pressurePsi < 80 || tempC > 80) {
        alertLevel = 'CRITICAL';
      } else if (wearPercent > 70 || pressurePsi < 90 || tempC > 70) {
        alertLevel = 'WARNING';
      }

      return {
        position,
        pressurePsi,
        tempC,
        wearPercent,
        remainingLifeKm,
        alertLevel,
        recommendation: alertLevel === 'CRITICAL' ? 'Immediate tire replacement required' :
                        alertLevel === 'WARNING' ? 'Schedule tire inspection/rotation soon' : 'Tire condition optimal'
      };
    });

    const hasCritical = analyzedTires.some(t => t.alertLevel === 'CRITICAL');
    const overallHealth = hasCritical ? 'CRITICAL_ATTENTION_REQUIRED' : 'OPERATIONAL';

    const report = {
      ownerId,
      truckId,
      overallHealth,
      tires: analyzedTires,
      evaluatedAt: new Date().toISOString()
    };

    this.pruneExpiredReports();
    const key = reportKey(ownerId, truckId);
    if (!this.truckTireReports.has(key) && this.truckTireReports.size >= MAX_RETAINED_TIRE_REPORTS) {
      const error = new Error('Tire analytics report capacity reached; try again later');
      error.statusCode = 429;
      throw error;
    }

    this.truckTireReports.set(key, report);
    logger.info(`[TireAnalyticsService] Analyzed ${analyzedTires.length} tires for truck ${truckId}`);

    return report;
  }

  /**
   * Retrieves latest tire health status for a truck
   */
  async getTireStatus(truckId, ownerId) {
    this.pruneExpiredReports();
    if (ownerId) {
      return this.truckTireReports.get(reportKey(ownerId, truckId)) || null;
    }

    // Admin lookup has no owner scope, so return the newest report for the
    // truck rather than whichever entry happens to be first in the map.
    let latest = null;
    let latestAt = -Infinity;
    for (const report of this.truckTireReports.values()) {
      if (report.truckId !== truckId) continue;
      const evaluatedAt = Date.parse(report.evaluatedAt);
      if (Number.isFinite(evaluatedAt) && evaluatedAt >= latestAt) {
        latest = report;
        latestAt = evaluatedAt;
      }
    }
    return latest;
  }
}

export const tireAnalyticsService = new TireAnalyticsService();
