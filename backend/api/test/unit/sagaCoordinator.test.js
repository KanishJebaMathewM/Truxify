import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SagaCoordinator,
  SagaExecutionError,
  SAGA_STATUS,
  DatabaseSagaPersister,
} from '../../src/core/saga/index.js';

describe('SagaCoordinator', () => {
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  describe('Step Registration & Validation', () => {
    it('throws when step name is missing or empty', () => {
      const saga = new SagaCoordinator({ logger: mockLogger });
      expect(() => saga.addStep({ execute: async () => {} })).toThrow(/valid non-empty string name/);
      expect(() => saga.addStep({ name: '', execute: async () => {} })).toThrow(/valid non-empty string name/);
    });

    it('throws when execute is not a function', () => {
      const saga = new SagaCoordinator({ logger: mockLogger });
      expect(() => saga.addStep({ name: 'step1', execute: 'not-a-fn' })).toThrow(/provide an execute function/);
    });

    it('throws when compensate is provided but is not a function', () => {
      const saga = new SagaCoordinator({ logger: mockLogger });
      expect(() => saga.addStep({ name: 'step1', execute: async () => {}, compensate: 123 })).toThrow(/compensate must be a function/);
    });

    it('allows method chaining for adding steps', () => {
      const saga = new SagaCoordinator({ logger: mockLogger });
      const returned = saga
        .addStep({ name: 'step1', execute: async () => {} })
        .addStep({ name: 'step2', execute: async () => {} });
      expect(returned).toBe(saga);
      expect(saga.steps.length).toBe(2);
    });
  });

  describe('Happy Path Forward Execution', () => {
    it('executes steps sequentially and returns final context and log', async () => {
      const executionOrder = [];
      const saga = new SagaCoordinator({ name: 'OrderCreationSaga', logger: mockLogger });

      saga
        .addStep({
          name: 'reserveInventory',
          execute: async (ctx) => {
            executionOrder.push('reserveInventory');
            ctx.inventoryReserved = true;
            return { reservationId: 'res-101' };
          },
        })
        .addStep({
          name: 'processPayment',
          execute: async (ctx) => {
            executionOrder.push('processPayment');
            expect(ctx.inventoryReserved).toBe(true);
            expect(ctx.reservationId).toBe('res-101');
            return { paymentTx: 'tx-555' };
          },
        })
        .addStep({
          name: 'dispatchNotification',
          execute: async (ctx) => {
            executionOrder.push('dispatchNotification');
            expect(ctx.paymentTx).toBe('tx-555');
            return { notified: true };
          },
        });

      const result = await saga.execute({ orderId: 'ord-1' });

      expect(executionOrder).toEqual(['reserveInventory', 'processPayment', 'dispatchNotification']);
      expect(result.status).toBe(SAGA_STATUS.COMPLETED);
      expect(result.context.orderId).toBe('ord-1');
      expect(result.context.inventoryReserved).toBe(true);
      expect(result.context.reservationId).toBe('res-101');
      expect(result.context.paymentTx).toBe('tx-555');
      expect(result.context.notified).toBe(true);
      expect(result.executionLog.length).toBe(3);
      expect(result.executionLog.every((l) => l.status === 'COMPLETED')).toBe(true);
      expect(saga.getStatus()).toBe(SAGA_STATUS.COMPLETED);
    });
  });

  describe('Failure & LIFO Compensation Rollback', () => {
    it('triggers compensations in reverse LIFO order when an intermediate step fails', async () => {
      const executionLog = [];
      const compensationLog = [];

      const saga = new SagaCoordinator({ name: 'OrderCancelSaga', logger: mockLogger });

      saga
        .addStep({
          name: 'step1_dbPending',
          execute: async (ctx) => {
            executionLog.push('step1');
            ctx.dbUpdated = true;
          },
          compensate: async (ctx) => {
            compensationLog.push('step1_revert');
            ctx.dbUpdated = false;
          },
        })
        .addStep({
          name: 'step2_escrowRefund',
          execute: async (ctx) => {
            executionLog.push('step2');
            ctx.escrowRefundSubmitted = true;
          },
          compensate: async (ctx) => {
            compensationLog.push('step2_revert');
            ctx.escrowRefundSubmitted = false;
          },
        })
        .addStep({
          name: 'step3_notifyCustomer',
          execute: async () => {
            executionLog.push('step3');
            throw new Error('FCM network failure');
          },
          compensate: async () => {
            compensationLog.push('step3_revert');
          },
        })
        .addStep({
          name: 'step4_unreached',
          execute: async () => {
            executionLog.push('step4');
          },
        });

      await expect(saga.execute({ orderId: 'ord-99' })).rejects.toThrow(SagaExecutionError);

      // Verify execution stopped at step3
      expect(executionLog).toEqual(['step1', 'step2', 'step3']);
      // Verify compensation executed in reverse order for executed steps (step2, then step1)
      expect(compensationLog).toEqual(['step2_revert', 'step1_revert']);
      expect(saga.getStatus()).toBe(SAGA_STATUS.COMPENSATED);

      const log = saga.getExecutionLog();
      const failedStep = log.find((l) => l.name === 'step3_notifyCustomer');
      expect(failedStep.status).toBe('FAILED');
      expect(failedStep.error).toContain('FCM network failure');

      const compensatedSteps = log.filter((l) => l.status === 'COMPENSATED');
      expect(compensatedSteps.length).toBe(2);
    });

    it('encapsulates triggerError and status in SagaExecutionError', async () => {
      const saga = new SagaCoordinator({ name: 'TestSaga', logger: mockLogger });
      const customDomainError = new Error('Custom business violation');
      customDomainError.status = 409;
      customDomainError.payload = { code: 'ORDER_NOT_CANCELLABLE' };

      saga.addStep({
        name: 'failingStep',
        execute: async () => {
          throw customDomainError;
        },
      });

      try {
        await saga.execute({});
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SagaExecutionError);
        expect(err.triggerError).toBe(customDomainError);
        expect(err.status).toBe(409);
        expect(err.payload).toEqual({ code: 'ORDER_NOT_CANCELLABLE' });
        expect(err.sagaStatus).toBe(SAGA_STATUS.COMPENSATED);
      }
    });

    it('continues compensating remaining steps even if one compensation throws (fault-tolerant)', async () => {
      const compensationLog = [];
      const saga = new SagaCoordinator({ name: 'FaultTolerantSaga', logger: mockLogger });

      saga
        .addStep({
          name: 'step1',
          execute: async () => {},
          compensate: async () => {
            compensationLog.push('step1_compensated');
          },
        })
        .addStep({
          name: 'step2_failing_compensation',
          execute: async () => {},
          compensate: async () => {
            compensationLog.push('step2_failed');
            throw new Error('Compensation error in step2');
          },
        })
        .addStep({
          name: 'step3_failing_execute',
          execute: async () => {
            throw new Error('Step 3 trigger error');
          },
        });

      await expect(saga.execute()).rejects.toThrow(SagaExecutionError);

      // step2 compensation was attempted and threw, but step1 compensation STILL ran!
      expect(compensationLog).toEqual(['step2_failed', 'step1_compensated']);
      // Status is marked FAILED because a compensation threw
      expect(saga.getStatus()).toBe(SAGA_STATUS.FAILED);

      const log = saga.getExecutionLog();
      const compFailed = log.find((l) => l.name === 'step2_failing_compensation:compensate');
      expect(compFailed.status).toBe('COMPENSATION_FAILED');
      expect(compFailed.error).toContain('Compensation error in step2');
    });
  });

  describe('DatabaseSagaPersister Integration', () => {
    it('notifies persister of state transitions during execution and rollback', async () => {
      const persistedCheckpoints = [];
      const mockPersister = {
        persistState: vi.fn(async (data) => {
          persistedCheckpoints.push(data.status);
          return true;
        }),
      };

      const saga = new SagaCoordinator({
        name: 'PersistedSaga',
        statePersister: mockPersister,
        logger: mockLogger,
      });

      saga
        .addStep({
          name: 'step1',
          execute: async () => {},
          compensate: async () => {},
        })
        .addStep({
          name: 'step2',
          execute: async () => {
            throw new Error('Simulated crash');
          },
        });

      await expect(saga.execute({ orderId: 'ord-123' })).rejects.toThrow(SagaExecutionError);

      // Transitions: RUNNING -> COMPENSATING -> COMPENSATED
      expect(persistedCheckpoints).toEqual([
        SAGA_STATUS.RUNNING,
        SAGA_STATUS.COMPENSATING,
        SAGA_STATUS.COMPENSATED,
      ]);
      expect(mockPersister.persistState).toHaveBeenCalled();
    });

    it('DatabaseSagaPersister writes formatted records to supabase', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          insert: mockInsert,
        }),
      };

      const persister = new DatabaseSagaPersister({
        supabaseClient: mockSupabase,
        tableName: 'application_audit_logs',
        logger: mockLogger,
      });

      const success = await persister.persistState({
        sagaName: 'OrderSaga',
        sagaId: 'saga-001',
        status: SAGA_STATUS.COMPLETED,
        context: { orderId: 'ord-555' },
        executionLog: [{ name: 'step1', status: 'COMPLETED' }],
      });

      expect(success).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('application_audit_logs');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'saga:OrderSaga:completed',
          resource_type: 'order_saga',
          resource_id: 'ord-555',
          metadata: expect.objectContaining({
            sagaId: 'saga-001',
            status: SAGA_STATUS.COMPLETED,
            stepCount: 1,
          }),
        })
      );
    });

    it('DatabaseSagaPersister handles null supabaseClient gracefully without throwing', async () => {
      const persister = new DatabaseSagaPersister({ supabaseClient: null });
      const result = await persister.persistState({
        sagaName: 'Test',
        sagaId: 's-1',
        status: SAGA_STATUS.RUNNING,
        context: {},
      });
      expect(result).toBe(false);
    });
  });
});
