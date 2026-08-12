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
        type: 'EMERGENCY_RECOVERED',
        severity: SEVERITY_LEVELS.CRITICAL,
        recipient: '0xRecipient',
        amount: '1000',
      };

      await router.route(alert);

      expect(mockSlack.sendMessage).toHaveBeenCalled();
      expect(mockEmail.send).toHaveBeenCalled();
      expect(mockSms.send).toHaveBeenCalled();
    });

    it('routes HIGH alerts to Slack and Email', async () => {
      const alert = {
        type: 'BOOKING_DISPUTED',
        severity: SEVERITY_LEVELS.HIGH,
        bookingId: '101',
        raisedBy: '0xCustomer',
      };

      await router.route(alert);

      expect(mockSlack.sendMessage).toHaveBeenCalled();
      expect(mockEmail.send).toHaveBeenCalled();
      expect(mockSms.send).not.toHaveBeenCalled();
    });

    it('routes MEDIUM alerts to Slack only', async () => {
      const alert = {
        type: 'PAYMENT_RELEASED',
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
        type: 'BOOKING_DISPUTED',
        severity: 'HIGH',
        bookingId: '42',
        raisedBy: '0xCustomer',
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
        type: 'EMERGENCY_RECOVERED',
        severity: 'CRITICAL',
        recipient: '0xRecipient',
        amount: '1000',
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

    it('handles payment released event', async () => {
      const args = [42n, '0xDriver', 1000n];
      const log = { transactionHash: '0xTx', blockNumber: 12345 };

      await monitor.handlePaymentReleased(args, log);

      expect(mockAlertRouter.route).toHaveBeenCalledWith(expect.objectContaining({
        type: 'PAYMENT_RELEASED',
        severity: 'MEDIUM',
        driver: '0xDriver',
      }));
      expect(mockMetrics.recordPaymentEvent).toHaveBeenCalledWith('success');
    });

    it('handles booking disputed event with escalation', async () => {
      const args = [7n, '0xCustomer'];
      const log = { transactionHash: '0xTx', blockNumber: 12346 };

      await monitor.handleBookingDisputed(args, log);

      expect(mockAlertRouter.route).toHaveBeenCalledWith(expect.objectContaining({
        type: 'BOOKING_DISPUTED',
        severity: 'HIGH',
        bookingId: '7',
      }));
      expect(mockEscalation.escalate).toHaveBeenCalled();
    });

    it('handles emergency recovered event', async () => {
      const args = ['0xAdmin', 500n];
      const log = { transactionHash: '0xTx', blockNumber: 12347 };

      await monitor.handleEmergencyRecovered(args, log);

      expect(mockAlertRouter.route).toHaveBeenCalledWith(expect.objectContaining({
        type: 'EMERGENCY_RECOVERED',
        severity: 'CRITICAL',
        recipient: '0xAdmin',
      }));
      expect(mockEscalation.escalate).toHaveBeenCalled();
      expect(mockMetrics.recordContractRevert).toHaveBeenCalled();
    });
  });
});
