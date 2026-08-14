import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockTransaction = {
  startChild: vi.fn(() => ({ setStatus: vi.fn(), finish: vi.fn() })),
  setData: vi.fn(),
  setMeasurement: vi.fn(),
  setStatus: vi.fn(),
  recordException: vi.fn(),
  finish: vi.fn(),
};

const mockSentry = vi.hoisted(() => ({
  init: vi.fn(),
  startTransaction: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  Integrations: {
    Http: vi.fn(),
    Express: vi.fn(),
    Postgres: vi.fn(),
    Redis: vi.fn(),
  },
}));

vi.mock('@sentry/node', () => mockSentry);
vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import TransactionMonitor from '../../src/services/monitoring/transactionMonitor.js';

describe('TransactionMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TransactionMonitor.initialized = false;
    mockSentry.startTransaction.mockReturnValue(mockTransaction);
  });

  describe('initialize', () => {
    it('initializes Sentry', () => {
      TransactionMonitor.initialize('dsn-1');
      expect(mockSentry.init).toHaveBeenCalledWith(expect.objectContaining({ dsn: 'dsn-1' }));
      expect(TransactionMonitor.initialized).toBe(true);
    });

    it('warns and returns on double init', () => {
      TransactionMonitor.initialize('dsn-1');
      TransactionMonitor.initialize('dsn-2');
      expect(mockSentry.init).toHaveBeenCalledTimes(1);
    });
  });

  describe('monitor', () => {
    it('runs the function and marks the span ok', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const result = await TransactionMonitor.monitor('job', fn);
      expect(result).toBe('result');
      expect(mockTransaction.setStatus).toHaveBeenCalledWith('ok');
      expect(mockTransaction.finish).toHaveBeenCalled();
    });

    it('records exceptions and rethrows on error', async () => {
      const error = new Error('boom');
      const fn = vi.fn().mockRejectedValue(error);
      await expect(TransactionMonitor.monitor('job', fn)).rejects.toThrow('boom');
      expect(mockTransaction.setStatus).toHaveBeenCalledWith('error');
      expect(mockTransaction.recordException).toHaveBeenCalledWith(error);
      expect(mockSentry.captureException).toHaveBeenCalled();
    });
  });

  describe('setUser', () => {
    it('calls Sentry.setUser with metadata', () => {
      TransactionMonitor.setUser('u1', 'a@b.com', { role: 'driver' });
      expect(mockSentry.setUser).toHaveBeenCalledWith({ id: 'u1', email: 'a@b.com', role: 'driver' });
    });
  });

  describe('trackBusinessTransaction', () => {
    it('creates a transaction with complete method', () => {
      const biz = TransactionMonitor.trackBusinessTransaction('order.created', { id: 1 });
      expect(mockSentry.startTransaction).toHaveBeenCalledWith(expect.objectContaining({
        name: 'biz.order.created',
        op: 'business_transaction',
      }));
      biz.complete('ok', { extra: 1 });
      expect(mockTransaction.setData).toHaveBeenCalledWith('status', 'ok');
      expect(mockTransaction.finish).toHaveBeenCalled();
    });
  });

  describe('addBreadcrumb', () => {
    it('adds a breadcrumb with timestamp', () => {
      TransactionMonitor.addBreadcrumb('hello');
      expect(mockSentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
        message: 'hello',
        category: 'custom',
        level: 'info',
      }));
    });
  });
});
