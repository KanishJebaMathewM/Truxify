import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockSentry = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(() => ({
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('@sentry/node', () => ({
  captureException: mockSentry.captureException,
}));

vi.mock('../../../../src/config/db.js', () => ({
  supabase: mockSupabase,
  supabaseAdmin: mockSupabase,
}));

vi.mock('../../../../src/core/performanceMetrics.js', () => ({
  measureExecution: (name, fn) => fn(),
}));

import EscalationHandler, {
  ESCALATION_LEVELS,
  ESCALATION_THRESHOLDS,
} from '../../../../src/services/blockchain/escalationHandler.js';

describe('EscalationHandler', () => {
  let handler;
  let mockNotificationService;
  let mockAlertRouter;
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.ON_CALL_ENGINEER = 'oncall1@truxify.io,oncall2@truxify.io';
    process.env.SENIOR_ENGINEER_CONTACTS = 'senior1@truxify.io';
    process.env.OPERATIONS_TEAM_CONTACTS = 'ops@truxify.io';

    mockNotificationService = {
      sendAlert: vi.fn().mockResolvedValue({ success: true }),
    };
    mockAlertRouter = {
      route: vi.fn().mockResolvedValue([]),
    };

    handler = new EscalationHandler({
      notificationService: mockNotificationService,
      alertRouter: mockAlertRouter,
    });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.useRealTimers();
  });

  const SAMPLE_ALERT = {
    type: 'BALANCE_DIVERGENCE',
    severity: 'HIGH',
    driver: 'driver-999',
    wallet: '0x1234567890abcdef',
    reason: 'On-chain balance diverges from ledger by 15%',
  };

  describe('Initialization and Alert ID Generation', () => {
    it('initializes with empty activeAlerts and escalationTimers maps', () => {
      expect(handler.activeAlerts.size).toBe(0);
      expect(handler.escalationTimers.size).toBe(0);
      expect(handler.notificationService).toBe(mockNotificationService);
      expect(handler.alertRouter).toBe(mockAlertRouter);
    });

    it('generates consistent 16-character hex alert IDs based on alert properties', () => {
      const id1 = handler.generateAlertId(SAMPLE_ALERT);
      const id2 = handler.generateAlertId(SAMPLE_ALERT);
      expect(id1).toBe(id2);
      expect(id1).toHaveLength(16);

      const walletAlert = { type: 'TX_STUCK', wallet: '0x999' };
      const shipmentAlert = { type: 'ROUTE_DEVIATION', shipmentId: 'shp-100' };
      const fallbackAlert = { type: 'GENERIC_ALERT' };

      expect(handler.generateAlertId(walletAlert)).toHaveLength(16);
      expect(handler.generateAlertId(shipmentAlert)).toHaveLength(16);
      expect(handler.generateAlertId(fallbackAlert)).toHaveLength(16);
    });
  });

  describe('escalate() tracking and throttling', () => {
    it('tracks a new alert, creates escalation record, stores it, and sets up timers', async () => {
      vi.useFakeTimers();

      await handler.escalate(SAMPLE_ALERT);

      const alertId = handler.generateAlertId(SAMPLE_ALERT);
      expect(handler.activeAlerts.has(alertId)).toBe(true);
      const record = handler.activeAlerts.get(alertId);
      expect(record.alertId).toBe(alertId);
      expect(record.level).toBe(ESCALATION_LEVELS.ALERT);
      expect(record.resolved).toBe(false);

      expect(handler.escalationTimers.has(alertId)).toBe(true);
      expect(handler.escalationTimers.get(alertId)).toHaveLength(3);

      expect(mockSupabase.from).toHaveBeenCalledWith('blockchain_escalations');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(`[EscalationHandler] Started tracking alert: ${alertId}`)
      );
    });

    it('throttles duplicate alerts to prevent spam when an alert is already being tracked', async () => {
      await handler.escalate(SAMPLE_ALERT);
      const alertId = handler.generateAlertId(SAMPLE_ALERT);

      // Attempt to escalate the same alert again while still active
      await handler.escalate(SAMPLE_ALERT);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `[EscalationHandler] Alert ${alertId} already being tracked`
      );
      // Supabase store should only have been called once for initial tracking
      expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    });
  });

  describe('Threshold-based escalation progression', () => {
    it('triggers ON_CALL escalation when first threshold (5 min) is reached', async () => {
      vi.useFakeTimers();

      await handler.escalate(SAMPLE_ALERT);
      const alertId = handler.generateAlertId(SAMPLE_ALERT);

      // Advance time by 5 minutes
      await vi.advanceTimersByTimeAsync(ESCALATION_THRESHOLDS.FIRST_ESCALATION);

      const record = handler.activeAlerts.get(alertId);
      expect(record.level).toBe(ESCALATION_LEVELS.ON_CALL);
      expect(record.escalatedAt).toHaveLength(1);
      expect(record.escalatedAt[0].level).toBe(ESCALATION_LEVELS.ON_CALL);

      expect(mockAlertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BALANCE_DIVERGENCE_ESCALATED',
          severity: 'CRITICAL',
          escalationLevel: 'ON_CALL',
          previousLevel: 'ALERT',
          escalationMessage: 'Alert not acknowledged. Paging on-call engineer.',
        })
      );

      // Notifications sent to on-call engineers
      expect(mockNotificationService.sendAlert).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.sendAlert).toHaveBeenCalledWith({
        recipient: 'oncall1@truxify.io',
        alert: SAMPLE_ALERT,
        escalationLevel: ESCALATION_LEVELS.ON_CALL,
        message: 'Alert not acknowledged. Paging on-call engineer.',
      });
      expect(mockNotificationService.sendAlert).toHaveBeenCalledWith({
        recipient: 'oncall2@truxify.io',
        alert: SAMPLE_ALERT,
        escalationLevel: ESCALATION_LEVELS.ON_CALL,
        message: 'Alert not acknowledged. Paging on-call engineer.',
      });
    });

    it('progresses through SENIOR_ENGINEER (15 min) and OPERATIONS (60 min) thresholds', async () => {
      vi.useFakeTimers();

      await handler.escalate(SAMPLE_ALERT);
      const alertId = handler.generateAlertId(SAMPLE_ALERT);

      // Advance time to 15 minutes (SENIOR_ENGINEER)
      await vi.advanceTimersByTimeAsync(ESCALATION_THRESHOLDS.SECOND_ESCALATION);

      let record = handler.activeAlerts.get(alertId);
      expect(record.level).toBe(ESCALATION_LEVELS.SENIOR_ENGINEER);
      expect(mockAlertRouter.route).toHaveBeenLastCalledWith(
        expect.objectContaining({
          escalationLevel: 'SENIOR_ENGINEER',
          previousLevel: 'ON_CALL',
          escalationMessage: 'Alert not resolved. Escalating to senior engineer.',
        })
      );
      expect(mockNotificationService.sendAlert).toHaveBeenCalledWith({
        recipient: 'senior1@truxify.io',
        alert: SAMPLE_ALERT,
        escalationLevel: ESCALATION_LEVELS.SENIOR_ENGINEER,
        message: 'Alert not resolved. Escalating to senior engineer.',
      });

      // Advance time to 60 minutes (OPERATIONS)
      await vi.advanceTimersByTimeAsync(
        ESCALATION_THRESHOLDS.FINAL_ESCALATION - ESCALATION_THRESHOLDS.SECOND_ESCALATION
      );

      record = handler.activeAlerts.get(alertId);
      expect(record.level).toBe(ESCALATION_LEVELS.OPERATIONS);
      expect(mockAlertRouter.route).toHaveBeenLastCalledWith(
        expect.objectContaining({
          escalationLevel: 'OPERATIONS',
          previousLevel: 'SENIOR_ENGINEER',
          escalationMessage: 'Alert critical. Notifying operations team.',
        })
      );
      expect(mockNotificationService.sendAlert).toHaveBeenCalledWith({
        recipient: 'ops@truxify.io',
        alert: SAMPLE_ALERT,
        escalationLevel: ESCALATION_LEVELS.OPERATIONS,
        message: 'Alert critical. Notifying operations team.',
      });
    });

    it('does not escalate if alert record is not found or already resolved', async () => {
      await handler.performEscalation('non_existent_id', ESCALATION_LEVELS.ON_CALL);
      expect(mockAlertRouter.route).not.toHaveBeenCalled();
      expect(mockNotificationService.sendAlert).not.toHaveBeenCalled();

      // Test with resolved record
      handler.activeAlerts.set('resolved_id', { resolved: true });
      await handler.performEscalation('resolved_id', ESCALATION_LEVELS.ON_CALL);
      expect(mockAlertRouter.route).not.toHaveBeenCalled();
    });
  });

  describe('Notification error handling', () => {
    it('catches notification dispatch errors, logs error, and reports to Sentry', async () => {
      const notifError = new Error('Notification webhook unavailable');
      mockNotificationService.sendAlert.mockRejectedValue(notifError);

      const record = {
        alert: SAMPLE_ALERT,
      };

      await handler.notifyEscalation(ESCALATION_LEVELS.ON_CALL, record);

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[EscalationHandler] Failed to notify escalation:',
        'Notification webhook unavailable'
      );
      expect(mockSentry.captureException).toHaveBeenCalledWith(notifError);
    });

    it('handles empty recipient configuration gracefully', async () => {
      delete process.env.ON_CALL_ENGINEER;
      const record = { alert: SAMPLE_ALERT };

      await handler.notifyEscalation(ESCALATION_LEVELS.ON_CALL, record);

      expect(mockNotificationService.sendAlert).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[EscalationHandler] Escalation notification sent to 0 recipients'
      );
    });
  });

  describe('resolveAlert()', () => {
    it('marks alert resolved, clears pending timers, saves status, and removes from active tracking', async () => {
      vi.useFakeTimers();

      await handler.escalate(SAMPLE_ALERT);
      const alertId = handler.generateAlertId(SAMPLE_ALERT);

      const resolved = await handler.resolveAlert(alertId);

      expect(resolved).toBe(true);
      expect(handler.activeAlerts.has(alertId)).toBe(false);
      expect(handler.escalationTimers.has(alertId)).toBe(false);

      // Advance time past escalation threshold and verify no escalation occurs
      await vi.advanceTimersByTimeAsync(ESCALATION_THRESHOLDS.FIRST_ESCALATION);
      expect(mockAlertRouter.route).not.toHaveBeenCalled();
      expect(mockNotificationService.sendAlert).not.toHaveBeenCalled();
    });

    it('returns false and logs warning when trying to resolve an unknown alertId', async () => {
      const resolved = await handler.resolveAlert('unknown_alert_123');

      expect(resolved).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[EscalationHandler] Alert unknown_alert_123 not found'
      );
    });
  });

  describe('getActiveAlerts() and storeEscalation error handling', () => {
    it('returns a list of active unresolved alerts with calculated elapsedTime', async () => {
      await handler.escalate(SAMPLE_ALERT);
      const alertId = handler.generateAlertId(SAMPLE_ALERT);

      const active = await handler.getActiveAlerts();

      expect(active).toHaveLength(1);
      expect(active[0].alertId).toBe(alertId);
      expect(active[0].resolved).toBe(false);
      expect(typeof active[0].elapsedTime).toBe('number');
    });

    it('handles Supabase storage errors gracefully without throwing', async () => {
      mockSupabase.from.mockImplementationOnce(() => {
        throw new Error('Supabase connection timeout');
      });

      await handler.storeEscalation({
        alertId: 'test_id',
        alert: SAMPLE_ALERT,
        createdAt: Date.now(),
        level: ESCALATION_LEVELS.ALERT,
        resolved: false,
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[EscalationHandler] Failed to store escalation:',
        'Supabase connection timeout'
      );
    });
  });
});
