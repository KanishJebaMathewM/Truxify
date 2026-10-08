// backend/api/src/services/security/anomalyDetectionService.js (Excerpt)

export class AnomalyDetectionService {
  constructor({ supabase, supabaseAdmin, logger }) {
    // CRITICAL FIX: Use supabaseAdmin for system-level security writes (anomaly logs & locks)
    this._supabase = supabaseAdmin || supabase;
    this.logger = logger;
  }

  async logAnomalies(userId, walletAddress, anomalies) {
    try {
      const { error } = await this._supabase
        .from('anomaly_log')
        .insert([{
          user_id: userId,
          wallet_address: walletAddress,
          anomalies,
          risk_level: this.calculateRiskLevel(anomalies),
          detected_at: new Date().toISOString(),
        }]);

      if (error) {
        this.logger.error({ err: error, userId }, 'Failed to persist anomaly log');
      }
    } catch (err) {
      this.logger.error({ err, userId }, 'Exception while logging anomalies');
    }
  }

  async lockAccount(userId, walletAddress, reason, anomalies, durationMs) {
    const lockedAt = new Date().toISOString();
    const lockedUntil = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;

    try {
      const { error } = await this._supabase
        .from('wallet_locks')
        .insert([{
          user_id: userId,
          wallet_address: walletAddress,
          reason,
          anomalies,
          locked_at: lockedAt,
          locked_until: lockedUntil,
        }]);

      if (error) {
        this.logger.error({ err: error, userId }, 'Failed to lock wallet account');
      }
    } catch (err) {
      this.logger.error({ err, userId }, 'Exception while locking wallet account');
    }
  }

  async unlockAccount(userId, walletAddress) {
    try {
      const { error } = await this._supabase
        .from('wallet_locks')
        .update({ unlocked_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('wallet_address', walletAddress)
        .is('unlocked_at', null);

      if (error) {
        this.logger.error({ err: error, userId }, 'Failed to unlock wallet account');
      }
    } catch (err) {
      this.logger.error({ err, userId }, 'Exception while unlocking wallet account');
    }
  }

  calculateRiskLevel(anomalies) {
    // Risk calculation logic...
    return 'HIGH';
  }
}
