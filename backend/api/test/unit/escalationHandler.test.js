/**
 * Unit tests for backend/api/src/services/blockchain/escalationHandler.js
 *
 * Run with:  npm run test:unit -- test/unit/escalationHandler.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('../../middleware/logger.js', () => ({
  default: mockLogger,
}));

const { EscalationHandler } = require('../../src/services/blockchain/escalationHandler.js');

describe('EscalationHandler', () => {
  let handler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new EscalationHandler();
  });

  describe('generateAlertId', () => {
    it('generates a unique ID for each alert', () => {
      const alert1 = { type: 'escrow_timeout', orderId: 'order-1' };
      const alert2 = { type: 'escrow_timeout', orderId: 'order-2' };
      const id1 = handler.generateAlertId(alert1);
      const id2 = handler.generateAlertId(alert2);
      expect(id1).not.toBe(id2);
    });
  });

  describe('duplicate alert detection', () => {
    it('warns when the same alert is escalated twice', async () => {
      const alert = { type: 'escrow_timeout', orderId: 'order-1' };
      await handler.escalate(alert);
      vi.clearAllMocks();
      await handler.escalate(alert);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('already being tracked')
      );
    });
  });
});
