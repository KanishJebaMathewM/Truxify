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

/**
 * Monetary amounts are represented as MATIC values that arrive as JS numbers or
 * numeric strings. IEEE-754 `double` summation drifts (the classic
 * `0.1 + 0.2 !== 0.3`) and biases the average/std-dev/z-score that gate the
 * LARGE_WITHDRAWAL security control. We therefore accumulate amounts as exact
 * integers using a fixed scale (1 MATIC === AMOUNT_SCALE internal units) and
 * only coerce back to a Number at the final threshold comparison.
 */
const AMOUNT_SCALE = 1000000n;

function toAmountUnits(value) {
  if (value === null || value === undefined || value === '') return 0n;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0n;
  const sign = num < 0 ? -1n : 1n;
  const abs = Math.abs(num);
  const intPart = Math.trunc(abs);
  const fracUnits = Math.round((abs - intPart) * Number(AMOUNT_SCALE));
  return sign * (BigInt(intPart) * AMOUNT_SCALE + BigInt(fracUnits));
}

function fromAmountUnits(units) {
  return Number(units) / Number(AMOUNT_SCALE);
}

const ANOMALY_SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

class AnomalyDetectionService {
  constructor(deps = {}) {
    this.alertRouter = deps.alertRouter;
    this.keyRotationService = deps.keyRotationService;
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

      const amount = toAmountUnits(transaction.amount || 0);
      const threshold = BigInt(ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL) * AMOUNT_SCALE;

      if (amount < threshold) {
        return null;
      }

      const userAvgWithdrawal = await this.getUserAverageWithdrawal(userId, walletAddress);
      const stdDev = await this.getUserWithdrawalStdDev(userId, walletAddress);

      const zScore = (fromAmountUnits(amount) - userAvgWithdrawal) / (stdDev || 1);

      if (zScore > 3) {
        return {
          type: 'LARGE_WITHDRAWAL',
          severity: 'HIGH',
          amount: fromAmountUnits(amount),
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

      const total = data.reduce((sum, t) => sum + toAmountUnits(t.amount), 0n);
      return fromAmountUnits(total) / data.length;
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

      const units = data.map(t => toAmountUnits(t.amount));
      const count = units.length;
      const sum = units.reduce((a, b) => a + b, 0n);
      const avg = fromAmountUnits(sum) / count;
      const variance = units.reduce((sum, u) => sum + Math.pow(fromAmountUnits(u) - avg, 2), 0) / count;
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
