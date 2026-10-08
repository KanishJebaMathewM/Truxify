import logger from '../../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { supabase, supabaseAdmin } from '../../config/db.js';
import { measureExecution } from '../../core/performanceMetrics.js';

const ANOMALY_THRESHOLDS = {
  LARGE_WITHDRAWAL: 1000, // Threshold in MATIC
  UNUSUAL_TIME: { startHour: 0, endHour: 6 }, // Unusual hours (UTC)
  MULTIPLE_TRANSFERS: 5, // Number of transfers in 10 minutes
  UNUSUAL_DESTINATION: true, // New wallet destination
};

/**
 * Defensive row cap on the 30-day withdrawal statistic pulls. PostgREST
 * silently caps a single response at 1000 rows, so without an explicit
 * bound the average/std-dev baseline would be computed from a truncated,
 * non-deterministic sample for wallets with more than 1000 withdrawals in
 * the window. Ordered by recency so the cap keeps the newest rows.
 */
const ANOMALY_STATS_MAX_ROWS = 1000;

const ANOMALY_SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

// Withdrawal amounts are stored as MATIC strings. Float summation of values
// like '0.1' drifts (ten 0.1 rows sum to 0.9999999999999999), so the baseline
// is accumulated as exact integer minor units on a fixed 18-decimal scale and
// converted back to a plain number only once at the end (#11498).
const DECIMAL_SCALE = 10n ** 18n;

function amountToMinorUnits(amount) {
  const s = String(amount ?? '').trim();
  if (!s || !Number.isFinite(Number(s))) return 0n;
  const negative = s.startsWith('-');
  const abs = negative ? s.slice(1) : s;
  const [intPart, fracPart = ''] = abs.split('.');
  const frac = (fracPart + '000000000000000000').slice(0, 18);
  let units = BigInt(intPart || '0') * DECIMAL_SCALE + BigInt(frac || '0');
  return negative ? -units : units;
}

class AnomalyDetectionService {
  constructor(deps = {}) {
    this.alertRouter = deps.alertRouter;
    this.keyRotationService = deps.keyRotationService;
    this.behavioralProfiles = new Map();
    this._maxBehavioralProfiles = deps.maxBehavioralProfiles || 5000;
    this._evictionFraction = deps.evictionFraction || 0.25;
    this._totalProfilesEvicted = 0;
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  _evictFromMap(map, maxSize, label = 'entries') {
    if (!map || map.size <= maxSize) return 0;

    const keys = [...map.keys()];
    const countToDelete = Math.max(
      Math.floor(keys.length * this._evictionFraction),
      map.size - maxSize
    );
    const toDelete = keys.slice(0, countToDelete);
    toDelete.forEach(k => map.delete(k));

    logger.info(`[AnomalyDetection] Evicted ${toDelete.length} stale ${label} (remaining: ${map.size})`);
    return toDelete.length;
  }

  recordBehavior(userId, behaviorData = {}) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      logger.debug('[AnomalyDetection] Skipping behavior tracking for unauthenticated/empty userId');
      return null;
    }

    let profile = this.behavioralProfiles.get(userId);
    if (!profile) {
      profile = {
        userId,
        events: [],
        patterns: {
          locationHistory: [],
          typingSpeed: [],
          transactionPatterns: [],
        },
        lastActivity: Date.now(),
        createdAt: Date.now(),
      };
      this.behavioralProfiles.set(userId, profile);
    }

    if (behaviorData.event) {
      profile.events.push(behaviorData.event);
    }
    if (behaviorData.lat != null && behaviorData.lng != null) {
      profile.patterns.locationHistory.push({
        lat: behaviorData.lat,
        lng: behaviorData.lng,
        timestamp: behaviorData.timestamp || Date.now(),
      });
    }
    if (Array.isArray(behaviorData.locationHistory)) {
      profile.patterns.locationHistory.push(...behaviorData.locationHistory);
    }
    if (behaviorData.patterns) {
      profile.patterns = { ...profile.patterns, ...behaviorData.patterns };
    }

    profile.lastActivity = Date.now();

    if (this.behavioralProfiles.size > this._maxBehavioralProfiles) {
      const evicted = this._evictFromMap(this.behavioralProfiles, this._maxBehavioralProfiles, 'behavioral profiles');
      this._totalProfilesEvicted += evicted;
    }

    return profile;
  }

  getBehaviorProfile(userId) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) return null;
    return this.behavioralProfiles.get(userId) || null;
  }

  detectAnomaly(dataOrUserId, options = {}) {
    let behaviorData = dataOrUserId;
    if (typeof dataOrUserId === 'string') {
      behaviorData = this.getBehaviorProfile(dataOrUserId);
    }
    if (!behaviorData) {
      return { isAnomaly: false, anomaly: false, reason: 'INSUFFICIENT_DATA', confidence: 0 };
    }

    const locations =
      behaviorData.patterns?.locationHistory ||
      behaviorData.locationHistory ||
      behaviorData.locations ||
      (Array.isArray(behaviorData) ? behaviorData : null);

    if (!Array.isArray(locations) || locations.length < 2) {
      return {
        isAnomaly: false,
        anomaly: false,
        reason: 'INSUFFICIENT_DATA',
        confidence: 0,
        message: 'Insufficient location data points for anomaly analysis',
      };
    }

    const maxAllowedSpeed = options.maxSpeedKmh || 150;
    let maxSpeedKmh = 0;
    let anomalousPair = null;

    for (let i = 1; i < locations.length; i++) {
      const prev = locations[i - 1];
      const curr = locations[i];
      if (prev.lat == null || prev.lng == null || curr.lat == null || curr.lng == null) continue;

      const distKm = this.calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng);
      const timeDiffMs = (curr.timestamp || 0) - (prev.timestamp || 0);
      const hours = timeDiffMs / 3_600_000;

      if (hours <= 0) {
        if (distKm > 1) {
          return {
            isAnomaly: true,
            anomaly: true,
            type: 'IMPOSSIBLE_SPEED',
            speedKmh: Infinity,
            reason: 'Zero-time teleportation detected',
            message: 'Impossible speed: instant location teleportation detected',
          };
        }
        continue;
      }

      const speedKmh = distKm / hours;
      if (speedKmh > maxSpeedKmh) {
        maxSpeedKmh = speedKmh;
        anomalousPair = { prev, curr, speedKmh, distKm };
      }
    }

    if (maxSpeedKmh > maxAllowedSpeed) {
      return {
        isAnomaly: true,
        anomaly: true,
        type: 'IMPOSSIBLE_SPEED',
        speedKmh: maxSpeedKmh,
        maxAllowedSpeed,
        details: anomalousPair,
        message: `Impossible speed detected: ${Math.round(maxSpeedKmh)} km/h exceeds threshold of ${maxAllowedSpeed} km/h`,
      };
    }

    return {
      isAnomaly: false,
      anomaly: false,
      maxSpeedKmh,
      message: 'Normal behavior',
    };
  }

  isWithdrawalDirection(transaction) {
    return String(transaction?.type || '').toLowerCase() === 'withdrawal';
  }


  async analyzeTransaction(userId, walletAddress, transaction) {
    return measureExecution('AnomalyDetectionService.analyzeTransaction', async () => {
      const anomalies = [];

      // Large-withdrawal scoring only applies to withdrawals. Deposits/credits
      // must never be compared against the user's withdrawal statistics, and
      // must never trigger an account lock.
      let largeWithdrawal = null;
      if (this.isWithdrawalDirection(transaction)) {
        largeWithdrawal = await this.detectLargeWithdrawal(userId, walletAddress, transaction);
      }
      if (largeWithdrawal) anomalies.push(largeWithdrawal);

      const unusualTime = this.detectUnusualTime(transaction);
      if (unusualTime) anomalies.push(unusualTime);

      const multipleTransfers = await this.detectMultipleTransfers(userId, walletAddress, transaction);
      if (multipleTransfers) anomalies.push(multipleTransfers);

      const unusualDestination = await this.detectUnusualDestination(userId, walletAddress, transaction);
      if (unusualDestination) anomalies.push(unusualDestination);

      if (anomalies.length > 0) {
        await this.handleAnomalies(userId, walletAddress, anomalies, transaction);
      }

      return {
        detectedAnomalies: anomalies,
        riskLevel: this.calculateRiskLevel(anomalies),
        shouldBlock: this.shouldBlockTransaction(anomalies),
      };
    });
  }

  async detectLargeWithdrawal(userId, walletAddress, transaction) {
    try {
      // Defense-in-depth: even if a caller forgets to check the direction,
      // never score a non-withdrawal transaction as a LARGE_WITHDRAWAL.
      if (!this.isWithdrawalDirection(transaction)) {
        return null;
      }

      const amount = parseFloat(transaction.amount || 0);

      // The statistical z-score check must run for every withdrawal, not only
      // those above the absolute MATIC ceiling. Gating it behind
      // LARGE_WITHDRAWAL let fraudsters keep each withdrawal just under 1000
      // MATIC to fully bypass the anomaly block / account lock (#14859).
      const userAvgWithdrawal = await this.getUserAverageWithdrawal(userId, walletAddress);
      const stdDev = await this.getUserWithdrawalStdDev(userId, walletAddress);

      const zScore = (amount - userAvgWithdrawal) / (stdDev || 1);

      if (zScore > 3 || amount >= ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL) {
        return {
          type: 'LARGE_WITHDRAWAL',
          severity: 'HIGH',
          amount,
          expectedAverage: userAvgWithdrawal,
          zScore,
          message: `Withdrawal ${Math.round(zScore)}x standard deviation above average`,
        };
      }

      return null;
    } catch (err) {
      logger.error('[AnomalyDetectionService] Large withdrawal detection failed:', err.message);
      return null;
    }
  }

  async getUserAverageWithdrawal(userId, walletAddress) {
    try {
      const { data, error } = await (supabaseAdmin || supabase)
        .from('wallet_transactions')
        .select('amount')
        .eq('driver_id', userId)
        .eq('txn_type', 'withdrawal')
        .eq('status', 'confirmed')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(ANOMALY_STATS_MAX_ROWS);

      if (error || !data || data.length === 0) {
        return ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL / 2;
      }

      const totalUnits = data.reduce((sum, t) => sum + amountToMinorUnits(t.amount), 0n);
      return Number(totalUnits) / data.length / 1e18;
    } catch (err) {
      logger.warn('[AnomalyDetectionService] Failed to calculate average withdrawal:', err.message);
      return ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL / 2;
    }
  }

  async getUserWithdrawalStdDev(userId, walletAddress) {
    try {
      const { data, error } = await (supabaseAdmin || supabase)
        .from('wallet_transactions')
        .select('amount')
        .eq('driver_id', userId)
        .eq('txn_type', 'withdrawal')
        .eq('status', 'confirmed')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(ANOMALY_STATS_MAX_ROWS);

      if (error || !data || data.length < 2) {
        return ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL / 4;
      }

      const allIdentical = data.every(t => amountToMinorUnits(t.amount) === amountToMinorUnits(data[0].amount));
      if (allIdentical) return 0;

      const totalUnits = data.reduce((sum, t) => sum + amountToMinorUnits(t.amount), 0n);
      const avg = Number(totalUnits) / data.length / 1e18;
      const amounts = data.map(t => Number(amountToMinorUnits(t.amount)) / 1e18);
      let varianceSum = 0;
      for (const amount of amounts) { varianceSum += Math.pow(amount - avg, 2); }
      const variance = varianceSum / amounts.length;
      return Math.sqrt(variance);
    } catch (err) {
      logger.warn('[AnomalyDetectionService] Failed to calculate std dev:', err.message);
      return ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL / 4;
    }
  }


  detectUnusualTime(transaction) {
    const txTime = new Date(transaction.timestamp);
    // Fix (#6127): use getUTCHours() so the window comparison is consistent
    // with the UTC ISO timestamp stored in transaction.timestamp and reported
    // in the message. getHours() returns server-local wall-clock time, which
    // produces wrong results on any server not running at UTC offset 0.
    const hour = txTime.getUTCHours();

    if (hour >= ANOMALY_THRESHOLDS.UNUSUAL_TIME.startHour &&
        hour < ANOMALY_THRESHOLDS.UNUSUAL_TIME.endHour) {
      return {
        type: 'UNUSUAL_TIME',
        severity: 'LOW',
        time: txTime.toISOString(),
        message: `Transaction at unusual hour: ${hour}:00 UTC`,
      };
    }

    return null;
  }

  async detectMultipleTransfers(userId, walletAddress, currentTransaction) {
    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const { count, error } = await (supabaseAdmin || supabase)
        .from('wallet_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('driver_id', userId)
        .eq('txn_type', 'withdrawal')
        .eq('status', 'confirmed')
        .gte('created_at', tenMinutesAgo);

      if (error) {
        return null;
      }

      const transferCount = count || 0;

      if (transferCount >= ANOMALY_THRESHOLDS.MULTIPLE_TRANSFERS) {
        return {
          type: 'MULTIPLE_TRANSFERS',
          severity: 'MEDIUM',
          count: transferCount,
          timeWindow: '10 minutes',
          message: `${transferCount} transfers in 10 minutes`,
        };
      }

      return null;
    } catch (err) {
      logger.error('[AnomalyDetectionService] Multiple transfers detection failed:', err.message);
      return null;
    }
  }

  async detectUnusualDestination(userId, walletAddress, transaction) {
    // The withdrawal ledger (wallet_transactions) does not persist destination
    // addresses, so destination history cannot be checked against the database.
    // Skip the check instead of querying the missing `transactions` table.
    return null;
  }

  calculateRiskLevel(anomalies) {
    if (anomalies.length === 0) return 'LOW';

    const severities = anomalies.map(a => a.severity);

    if (severities.includes('CRITICAL')) return 'CRITICAL';
    if (severities.includes('HIGH')) return 'HIGH';
    if (severities.includes('MEDIUM')) return 'MEDIUM';
    return 'LOW';
  }

  shouldBlockTransaction(anomalies) {
    return anomalies.some(a => a.severity === 'CRITICAL' || a.type === 'LARGE_WITHDRAWAL');
  }

  async handleAnomalies(userId, walletAddress, anomalies, transaction) {
    try {
      await this.logAnomalies(userId, walletAddress, anomalies);

      const riskLevel = this.calculateRiskLevel(anomalies);

      if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') {
        await this.triggerSecurityAlert(userId, walletAddress, anomalies, riskLevel);
      }

      if (this.shouldBlockTransaction(anomalies)) {
        await this.lockAccount(userId, walletAddress, 'anomaly_detected', anomalies);
      }
    } catch (err) {
      logger.error('[AnomalyDetectionService] Anomaly handling failed:', err.message);
      Sentry.captureException(err);
    }
  }

  async logAnomalies(userId, walletAddress, anomalies) {
    try {
      await (supabaseAdmin || supabase)
        .from('anomaly_log')
        .insert([{
          user_id: userId,
          wallet_address: walletAddress,
          anomalies,
          risk_level: this.calculateRiskLevel(anomalies),
          detected_at: new Date().toISOString(),
        }]);
    } catch (err) {
      logger.error('[AnomalyDetectionService] Failed to log anomalies:', err.message);
    }
  }

  async triggerSecurityAlert(userId, walletAddress, anomalies, riskLevel) {
    try {
      const alert = {
        type: 'WALLET_ANOMALY_DETECTED',
        severity: riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        userId,
        walletAddress,
        anomalies,
        message: `Suspicious wallet activity detected: ${anomalies.map(a => a.type).join(', ')}`,
        timestamp: new Date().toISOString(),
      };

      if (this.alertRouter) {
        await this.alertRouter.route(alert);
      }

      logger.warn('[AnomalyDetectionService] Security alert triggered:', alert);
    } catch (err) {
      logger.error('[AnomalyDetectionService] Failed to trigger alert:', err.message);
    }
  }

  async lockAccount(userId, walletAddress, reason, anomalies) {
    try {
      await (supabaseAdmin || supabase)
        .from('wallet_locks')
        .insert([{
          user_id: userId,
          wallet_address: walletAddress,
          reason,
          anomalies,
          locked_at: new Date().toISOString(),
          locked_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }]);

      logger.warn('[AnomalyDetectionService] Account locked:', userId, walletAddress);
    } catch (err) {
      logger.error('[AnomalyDetectionService] Failed to lock account:', err.message);
    }
  }

  async unlockAccount(userId, walletAddress) {
    try {
      await (supabaseAdmin || supabase)
        .from('wallet_locks')
        .update({ unlocked_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('wallet_address', walletAddress)
        .is('unlocked_at', null);

      logger.info('[AnomalyDetectionService] Account unlocked:', userId, walletAddress);
    } catch (err) {
      logger.error('[AnomalyDetectionService] Failed to unlock account:', err.message);
    }
  }
}

export default AnomalyDetectionService;
export { ANOMALY_THRESHOLDS, ANOMALY_SEVERITY };
