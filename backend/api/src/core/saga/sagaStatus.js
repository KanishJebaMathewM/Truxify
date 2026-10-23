/**
 * Status enumeration for the distributed Saga Coordinator state machine.
 */
export const SAGA_STATUS = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  COMPENSATING: 'COMPENSATING',
  COMPENSATED: 'COMPENSATED',
  FAILED: 'FAILED',
});
