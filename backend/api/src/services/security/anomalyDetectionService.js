import logger from '../../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { supabase } from '../../config/db.js';
import { measureExecution } from '../../core/performanceMetrics.js';

const ANOMALY_THRESHOLDS = {
  LARGE_WITHDRAWAL: 1000, // Threshold in MATIC
  UNUSUAL_TIME: { startHour: 0, endHour: 6 }, // Unusual hours (UTC)
  MULTIPLE_TRANSFERS: 5, // Number of transfers in 10 minutes
  UNUSUAL_DESTINATION: true, // New wallet destination
};

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

  async analyzeTransaction(userId, walletAddress, transaction) {
    return measureExecution('AnomalyDetectionService.analyzeTransaction', async () => {
      const anomalies = [];

      const largeWithdrawal = await this.detectLargeWithdrawal(userId, walletAddress, transaction);
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
      const amount = parseFloat(transaction.amount || 0);

      if (amount < ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL) {
        return null;
      }

      const userAvgWithdrawal = await this.getUserAverageWithdrawal(userId, walletAddress);
      const stdDev = await this.getUserWithdrawalStdDev(userId, walletAddress);

      const zScore = (amount - userAvgWithdrawal) / (stdDev || 1);

      if (zScore > 3) {
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
      const { data, error } = await supabase
        .from('transactions')
        .select('amount')
        .eq('user_id', userId)
        .eq('wallet_address', walletAddress)
        .eq('type', 'withdrawal')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

      if (error || !data || data.length === 0) {
        return ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL / 2;
      }

      const total = data.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
      return total / data.length;
    } catch (err) {
      logger.warn('[AnomalyDetectionService] Failed to calculate average withdrawal:', err.message);
      return ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL / 2;
    }
  }

  async getUserWithdrawalStdDev(userId, walletAddress) {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('amount')
        .eq('user_id', userId)
        .eq('wallet_address', walletAddress)
        .eq('type', 'withdrawal')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

      if (error || !data || data.length < 2) {
        return ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL / 4;
      }

      const amounts = data.map(t => parseFloat(t.amount) || 0);
      const avg = amounts.reduce((a, b) => a + b) / amounts.length;
      const variance = amounts.reduce((sum, a) => sum + Math.pow(a - avg, 2), 0) / amounts.length;
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

      const { data, error } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_id', userId)
        .eq('wallet_address', walletAddress)
        .gte('created_at', tenMinutesAgo);

      if (error || !data) {
        return null;
      }

      const transferCount = data.length;

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
    if (!ANOMALY_THRESHOLDS.UNUSUAL_DESTINATION || !transaction.toAddress) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_id', userId)
        .eq('to_address', transaction.toAddress)
        .limit(1);

      if (!error && data && data.length > 0) {
        return null;
      }

      return {
        type: 'UNUSUAL_DESTINATION',
        severity: 'MEDIUM',
        destination: transaction.toAddress,
        message: `First transfer to new address: ${transaction.toAddress.slice(0, 10)}...`,
      };
    } catch (err) {
      logger.error('[AnomalyDetectionService] Unusual destination detection failed:', err.message);
      return null;
    }
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
      await supabase
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
      await supabase
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
      await supabase
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
