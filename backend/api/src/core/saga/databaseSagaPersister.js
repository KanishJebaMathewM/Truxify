import logger from '../../middleware/logger.js';

/**
 * Persists Saga execution checkpoints into the database via Supabase or repository.
 * This guarantees observability, auditability, and recovery context across restarts.
 */
export class DatabaseSagaPersister {
  /**
   * @param {Object} options
   * @param {Object} [options.supabaseClient] - Supabase client (preferably supabaseAdmin)
   * @param {string} [options.tableName='application_audit_logs'] - Target audit / saga table
   * @param {Object} [options.logger] - Logger instance
   */
  constructor({ supabaseClient = null, tableName = 'application_audit_logs', logger: customLogger = null } = {}) {
    this.supabaseClient = supabaseClient;
    this.tableName = tableName;
    this.logger = customLogger || logger;
  }

  /**
   * Persist saga checkpoint state.
   *
   * @param {Object} payload
   * @param {string} payload.sagaName
   * @param {string} payload.sagaId
   * @param {string} payload.status
   * @param {Object} payload.context
   * @param {Array} payload.executionLog
   * @returns {Promise<boolean>}
   */
  async persistState({ sagaName, sagaId, status, context, executionLog, triggerError = null, compensationErrors = null }) {
    if (!this.supabaseClient) {
      this.logger.debug?.(`[DatabaseSagaPersister] No supabase client configured; skipping persistence for ${sagaId}`);
      return false;
    }

    try {
      const record = {
        action: `saga:${sagaName}:${status.toLowerCase()}`,
        resource_type: 'order_saga',
        resource_id: context?.orderId || context?.order?.id || sagaId,
        metadata: {
          sagaId,
          sagaName,
          status,
          stepCount: executionLog?.length || 0,
          triggerError,
          compensationErrors,
          executionLog,
        },
        created_at: new Date().toISOString(),
      };

      const { error } = await this.supabaseClient.from(this.tableName).insert(record);
      if (error) {
        this.logger.warn(`[DatabaseSagaPersister] Error writing saga log for ${sagaId}: ${error.message}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`[DatabaseSagaPersister] Exception writing saga checkpoint for ${sagaId}: ${err?.message}`);
      return false;
    }
  }
}
