import logger from '../../middleware/logger.js';
import { supabase, supabaseAdmin } from '../../config/db.js';
import { measureExecution } from '../../core/performanceMetrics.js';

class BlockchainMetrics {
  constructor() {
    this.metrics = {
      contractCallSuccessRate: 0,
      paymentProcessingLatency: [],
      withdrawalQueueDepth: 0,
      failedTransactionCount: 0,
      driverPayoutDelayAverage: 0,
      blocksScanedPerDay: 0,
      geofenceBreachCount: 0,
      insuranceEventsCount: 0,
      lastMetricsUpdate: new Date().toISOString(),
    };

    this.startMetricsCollection();
  }

  startMetricsCollection() {
    const metricsInterval = parseInt(process.env.METRICS_COLLECTION_INTERVAL_MS || '60000', 10);

    setInterval(async () => {
      try {
        await this.aggregateMetrics();
      } catch (error) {
        logger.error('Failed to aggregate blockchain metrics', error);
      }
    }, metricsInterval);
  }

  recordPaymentEvent(status) {
    if (status === 'success') {
      this.metrics.contractCallSuccessRate = (this.metrics.contractCallSuccessRate * 0.9) + 10;
    } else {
      this.metrics.contractCallSuccessRate = this.metrics.contractCallSuccessRate * 0.95;
    }
  }

  recordPaymentLatency(latencyMs) {
    this.metrics.paymentProcessingLatency.push(latencyMs);
    if (this.metrics.paymentProcessingLatency.length > 1000) {
      this.metrics.paymentProcessingLatency.shift();
    }
  }

  recordWithdrawalQueueDepth(depth) {
    this.metrics.withdrawalQueueDepth = depth;
  }

  recordFailedTransaction() {
    this.metrics.failedTransactionCount++;
  }

  recordDriverPayoutDelay(delayMinutes) {
    const latencies = [this.metrics.driverPayoutDelayAverage, delayMinutes];
    this.metrics.driverPayoutDelayAverage = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  }

  recordBlockScan(blockCount) {
    this.metrics.blocksScanedPerDay += blockCount;
  }

  recordBlockScanError() {
    logger.warn('[BlockchainMetrics] Block scan error recorded');
  }

  recordGeofenceBreach() {
    this.metrics.geofenceBreachCount++;
  }

  recordInsuranceEvent(status) {
    this.metrics.insuranceEventsCount++;
  }

  recordBalanceUpdateFailure() {
    this.metrics.failedTransactionCount++;
  }

  recordContractRevert() {
    this.metrics.failedTransactionCount++;
  }

  getAveragePaymentLatency() {
    if (this.metrics.paymentProcessingLatency.length === 0) return 0;
    const sum = this.metrics.paymentProcessingLatency.reduce((a, b) => a + b, 0);
    return sum / this.metrics.paymentProcessingLatency.length;
  }

  async aggregateMetrics() {
    return measureExecution('BlockchainMetrics.aggregateMetrics', async () => {
      try {
        const aggregatedMetrics = {
          timestamp: new Date().toISOString(),
          contract_call_success_rate: Math.round(this.metrics.contractCallSuccessRate),
          payment_processing_latency_avg: Math.round(this.getAveragePaymentLatency()),
          withdrawal_queue_depth: this.metrics.withdrawalQueueDepth,
          failed_transaction_count: this.metrics.failedTransactionCount,
          driver_payout_delay_avg: Math.round(this.metrics.driverPayoutDelayAverage),
          blocks_scanned_per_day: this.metrics.blocksScanedPerDay,
          geofence_breach_count: this.metrics.geofenceBreachCount,
          insurance_events_count: this.metrics.insuranceEventsCount,
        };

        await (supabaseAdmin || supabase)
          .from('blockchain_metrics')
          .insert([aggregatedMetrics]);

        this.metrics.lastMetricsUpdate = new Date().toISOString();
        this.metrics.blocksScanedPerDay = 0;

        logger.info('[BlockchainMetrics] Metrics aggregated:', aggregatedMetrics);
      } catch (err) {
        logger.error('[BlockchainMetrics] Failed to aggregate metrics:', err.message);
      }
    });
  }

  getMetrics() {
    return {
      ...this.metrics,
      paymentProcessingLatencyAvg: this.getAveragePaymentLatency(),
    };
  }
}

export default BlockchainMetrics;
