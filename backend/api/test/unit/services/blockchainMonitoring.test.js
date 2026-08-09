import { describe, it, expect, vi, beforeEach } from 'vitest';
import BlockchainMonitor from '../../../src/services/blockchain/blockchainMonitor.js';
import AlertRouter, { SEVERITY_LEVELS, ALERT_CHANNELS } from '../../../src/services/blockchain/alertRouter.js';
import EscalationHandler, { ESCALATION_LEVELS } from '../../../src/services/blockchain/escalationHandler.js';
import BlockchainMetrics from '../../../src/services/blockchain/blockchainMetrics.js';

describe('Blockchain Monitoring Suite', () => {
  describe('AlertRouter', () => {
    let router;
    let mockSlack;
    let mockEmail;
    let mockSms;

    beforeEach(() => {
      process.env.ALERT_EMAIL_RECIPIENTS = 'alerts@truxify.io';
      process.env.ALERT_SMS_RECIPIENTS = '+1234567890';
      mockSlack = { sendMessage: vi.fn().mockResolvedValue() };
      mockEmail = { send: vi.fn().mockResolvedValue() };
      mockSms = { send: vi.fn().mockResolvedValue() };

      router = new AlertRouter({
        slackClient: mockSlack,
        emailService: mockEmail,
        smsService: mockSms,
      });
    });

    it('routes CRITICAL alerts to Slack, Email, and SMS', async () => {
      const alert = {
        type: 'SMART_CONTRACT_REVERT',
        severity: SEVERITY_LEVELS.CRITICAL,
        reason: 'Out of gas',
        txHash: '0x123',
      };

      await router.route(alert);

      expect(mockSlack.sendMessage).toHaveBeenCalled();
      expect(mockEmail.send).toHaveBeenCalled();
      expect(mockSms.send).toHaveBeenCalled();
    });

    it('routes HIGH alerts to Slack and Email', async () => {
      const alert = {
        type: 'GEOFENCE_BREACH',
        severity: SEVERITY_LEVELS.HIGH,
        shipmentId: '101',
        driver: '0xDriver',
      };

      await router.route(alert);

      expect(mockSlack.sendMessage).toHaveBeenCalled();
      expect(mockEmail.send).toHaveBeenCalled();
      expect(mockSms.send).not.toHaveBeenCalled();
    });

    it('routes MEDIUM alerts to Slack only', async () => {
      const alert = {
        type: 'PAYMENT_RECEIVED',
        severity: SEVERITY_LEVELS.MEDIUM,
        amount: '1000',
      };

      await router.route(alert);

      expect(mockSlack.sendMessage).toHaveBeenCalled();
      expect(mockEmail.send).not.toHaveBeenCalled();
      expect(mockSms.send).not.toHaveBeenCalled();
    });
  });

  describe('EscalationHandler', () => {
    let escalation;
    let mockAlertRouter;

    beforeEach(() => {
      mockAlertRouter = { route: vi.fn().mockResolvedValue() };
      escalation = new EscalationHandler({ alertRouter: mockAlertRouter });
    });

    it('starts tracking and resolves alert', async () => {
      const alert = {
        type: 'BALANCE_UPDATE_FAILED',
        severity: 'CRITICAL',
        wallet: '0xWallet',
      };

      await escalation.escalate(alert);
      const active = await escalation.getActiveAlerts();
      expect(active.length).toBe(1);

      const alertId = active[0].alertId;
      const resolved = await escalation.resolveAlert(alertId);
      expect(resolved).toBe(true);

      const remaining = await escalation.getActiveAlerts();
      expect(remaining.length).toBe(0);
    });

    it('performs escalation steps correctly', async () => {
      const alert = {
        type: 'SMART_CONTRACT_REVERT',
        severity: 'CRITICAL',
        txHash: '0x456',
      };

      await escalation.escalate(alert);
      const active = await escalation.getActiveAlerts();
      const alertId = active[0].alertId;

      await escalation.performEscalation(alertId, ESCALATION_LEVELS.ON_CALL);
      expect(mockAlertRouter.route).toHaveBeenCalledWith(expect.objectContaining({
        severity: 'CRITICAL',
        escalationLevel: 'ON_CALL',
      }));

      await escalation.resolveAlert(alertId);
    });
  });

  describe('BlockchainMetrics', () => {
    let metrics;

    beforeEach(() => {
      metrics = new BlockchainMetrics();
    });

    it('records and aggregates metrics correctly', () => {
      metrics.recordPaymentEvent('success');
      metrics.recordPaymentLatency(150);
      metrics.recordPaymentLatency(250);
      metrics.recordGeofenceBreach();
      metrics.recordContractRevert();

      const current = metrics.getMetrics();
      expect(current.paymentProcessingLatencyAvg).toBe(200);
      expect(current.geofenceBreachCount).toBe(1);
      expect(current.failedTransactionCount).toBe(1);
    });
  });

  describe('BlockchainMonitor', () => {
    let monitor;
    let mockAlertRouter;
    let mockMetrics;
    let mockEscalation;

    beforeEach(() => {
      mockAlertRouter = { route: vi.fn().mockResolvedValue() };
      mockMetrics = {
        recordPaymentEvent: vi.fn(),
        recordInsuranceEvent: vi.fn(),
        recordGeofenceBreach: vi.fn(),
        recordBalanceUpdateFailure: vi.fn(),
        recordContractRevert: vi.fn(),
      };
      mockEscalation = { escalate: vi.fn().mockResolvedValue() };

      monitor = new BlockchainMonitor({
        alertRouter: mockAlertRouter,
        metricsService: mockMetrics,
        escalationHandler: mockEscalation,
      });
    });

    it('handles payment received event', async () => {
      const args = ['0xDriver', 1000n, 1700000000n];
      const log = { transactionHash: '0xTx', blockNumber: 12345 };

      await monitor.handlePaymentReceived(args, log);

      expect(mockAlertRouter.route).toHaveBeenCalledWith(expect.objectContaining({
        type: 'PAYMENT_RECEIVED',
        severity: 'MEDIUM',
        driver: '0xDriver',
      }));
      expect(mockMetrics.recordPaymentEvent).toHaveBeenCalledWith('success');
    });

    it('handles smart contract revert event', async () => {
      const args = ['0x1234567890abcdef', 'Out of gas'];
      const log = { blockNumber: 12346 };

      await monitor.handleSmartContractRevert(args, log);

      expect(mockAlertRouter.route).toHaveBeenCalledWith(expect.objectContaining({
        type: 'SMART_CONTRACT_REVERT',
        severity: 'CRITICAL',
        reason: 'Out of gas',
      }));
      expect(mockEscalation.escalate).toHaveBeenCalled();
      expect(mockMetrics.recordContractRevert).toHaveBeenCalled();
    });
  });
});
