import crypto from 'crypto';
import { SAGA_STATUS } from './sagaStatus.js';
import logger from '../../middleware/logger.js';
import { measureExecution } from '../performanceMetrics.js';

/**
 * Custom error thrown when a Saga execution fails and triggers compensation.
 */
export class SagaExecutionError extends Error {
  constructor(message, { sagaName, sagaId, stepName, triggerError, sagaStatus, executionLog, context }) {
    super(message);
    this.name = 'SagaExecutionError';
    this.sagaName = sagaName;
    this.sagaId = sagaId;
    this.stepName = stepName;
    this.triggerError = triggerError;
    this.sagaStatus = sagaStatus;
    this.executionLog = executionLog;
    this.context = context;

    if (triggerError && triggerError.status) {
      this.status = triggerError.status;
    }
    if (triggerError && triggerError.payload) {
      this.payload = triggerError.payload;
    }
  }
}

/**
 * Lightweight, robust Saga Pattern Coordinator for orchestrating distributed
 * multi-step transactions across PostgreSQL, Blockchain Escrow, and external services.
 */
export class SagaCoordinator {
  /**
   * @param {Object} [options]
   * @param {string} [options.name='GenericSaga'] - Identifier for metrics and logging
   * @param {Object} [options.statePersister=null] - Optional persister for saga state
   * @param {Object} [options.logger=null] - Custom logger override
   */
  constructor({ name = 'GenericSaga', statePersister = null, logger: customLogger = null } = {}) {
    this.name = name;
    this.sagaId = `saga_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.steps = [];
    this.status = SAGA_STATUS.PENDING;
    this.executionLog = [];
    this.context = {};
    this.statePersister = statePersister;
    this.logger = customLogger || logger;
  }

  /**
   * Register a transaction step with an optional compensation handler.
   *
   * @param {Object} stepDefinition
   * @param {string} stepDefinition.name - Descriptive step name
   * @param {Function} stepDefinition.execute - async (context) => Promise<any>
   * @param {Function} [stepDefinition.compensate] - async (context, error) => Promise<any>
   * @returns {SagaCoordinator} this for fluent chaining
   */
  addStep({ name, execute, compensate = null }) {
    if (!name || typeof name !== 'string') {
      throw new Error('Saga step must have a valid non-empty string name.');
    }
    if (typeof execute !== 'function') {
      throw new Error(`Saga step "${name}" must provide an execute function.`);
    }
    if (compensate != null && typeof compensate !== 'function') {
      throw new Error(`Saga step "${name}" compensate must be a function if provided.`);
    }

    this.steps.push({ name, execute, compensate });
    return this;
  }

  /**
   * Execute all registered steps sequentially. If any step throws,
   * recorded compensation actions run in reverse (LIFO) order.
   *
   * @param {Object} [initialContext={}]
   * @returns {Promise<{ status: string, context: Object, executionLog: Array, sagaId: string }>}
   */
  async execute(initialContext = {}) {
    return measureExecution(`SagaCoordinator.${this.name}`, async () => {
      this.status = SAGA_STATUS.RUNNING;
      this.context = { ...initialContext };
      const executedSteps = [];

      await this._notifyStateChange(this.status, this.context);

      for (const step of this.steps) {
        const stepRecord = {
          name: step.name,
          startedAt: new Date().toISOString(),
          status: 'PENDING',
          result: null,
          error: null,
        };

        try {
          this.logger.info(`[Saga:${this.name}:${this.sagaId}] Executing step "${step.name}"`);
          const result = await step.execute(this.context);
          stepRecord.result = result;
          stepRecord.status = 'COMPLETED';
          stepRecord.completedAt = new Date().toISOString();

          executedSteps.push({ step, stepRecord, contextSnapshot: { ...this.context } });
          this.executionLog.push(stepRecord);

          // If the step returned an object, merge it into the shared context
          if (result && typeof result === 'object' && !Array.isArray(result)) {
            Object.assign(this.context, result);
          }
        } catch (stepErr) {
          stepRecord.status = 'FAILED';
          stepRecord.error = stepErr?.message ?? String(stepErr);
          stepRecord.failedAt = new Date().toISOString();
          this.executionLog.push(stepRecord);

          this.logger.error(
            `[Saga:${this.name}:${this.sagaId}] Step "${step.name}" failed: ${stepRecord.error}. Initiating compensation.`
          );

          await this._compensate(executedSteps, this.context, stepErr);

          throw new SagaExecutionError(
            `Saga "${this.name}" failed at step "${step.name}": ${stepRecord.error}`,
            {
              sagaName: this.name,
              sagaId: this.sagaId,
              stepName: step.name,
              triggerError: stepErr,
              sagaStatus: this.status,
              executionLog: this.executionLog,
              context: this.context,
            }
          );
        }
      }

      this.status = SAGA_STATUS.COMPLETED;
      await this._notifyStateChange(this.status, this.context);

      this.logger.info(
        `[Saga:${this.name}:${this.sagaId}] Successfully completed all ${this.steps.length} steps.`
      );

      return {
        status: this.status,
        context: this.context,
        executionLog: this.executionLog,
        sagaId: this.sagaId,
      };
    });
  }

  /**
   * Compensate previously executed steps in reverse order (LIFO).
   * Ensures that failure in one compensation does not block remaining compensations.
   *
   * @private
   */
  async _compensate(executedSteps, context, triggerError) {
    this.status = SAGA_STATUS.COMPENSATING;
    await this._notifyStateChange(this.status, context, { triggerError: triggerError?.message });

    let compensationFailed = false;
    const compensationErrors = [];

    // Reverse (LIFO) rollback order
    for (let i = executedSteps.length - 1; i >= 0; i--) {
      const { step } = executedSteps[i];
      if (typeof step.compensate === 'function') {
        try {
          this.logger.info(`[Saga:${this.name}:${this.sagaId}] Compensating step "${step.name}"`);
          await step.compensate(context, triggerError);
          this.executionLog.push({
            name: `${step.name}:compensate`,
            status: 'COMPENSATED',
            completedAt: new Date().toISOString(),
          });
        } catch (compErr) {
          compensationFailed = true;
          const errMsg = compErr?.message ?? String(compErr);
          compensationErrors.push({ stepName: step.name, error: errMsg });
          this.logger.error(
            `[Saga:${this.name}:${this.sagaId}] Compensation for step "${step.name}" failed: ${errMsg}`
          );
          this.executionLog.push({
            name: `${step.name}:compensate`,
            status: 'COMPENSATION_FAILED',
            error: errMsg,
            failedAt: new Date().toISOString(),
          });
        }
      }
    }

    this.status = compensationFailed ? SAGA_STATUS.FAILED : SAGA_STATUS.COMPENSATED;
    await this._notifyStateChange(this.status, context, {
      triggerError: triggerError?.message,
      compensationErrors: compensationErrors.length > 0 ? compensationErrors : null,
    });
  }

  /**
   * Notify optional state persister of status transitions.
   *
   * @private
   */
  async _notifyStateChange(status, context, extra = {}) {
    if (this.statePersister && typeof this.statePersister.persistState === 'function') {
      try {
        await this.statePersister.persistState({
          sagaName: this.name,
          sagaId: this.sagaId,
          status,
          context,
          executionLog: this.executionLog,
          updatedAt: new Date().toISOString(),
          ...extra,
        });
      } catch (persistErr) {
        this.logger.warn(
          `[Saga:${this.name}:${this.sagaId}] State persister failed: ${persistErr?.message}`
        );
      }
    }
  }

  getStatus() {
    return this.status;
  }

  getExecutionLog() {
    return [...this.executionLog];
  }

  getContext() {
    return { ...this.context };
  }
}
