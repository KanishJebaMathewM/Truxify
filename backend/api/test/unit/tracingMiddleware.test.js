import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockSpan = vi.hoisted(() => ({
  setAttributes: vi.fn(),
  addEvent: vi.fn(),
  recordException: vi.fn(),
  setStatus: vi.fn(),
  end: vi.fn(),
}));

const mockTracing = vi.hoisted(() => ({
  getTracer: vi.fn(() => ({
    startSpan: vi.fn(() => mockSpan),
  })),
  createSpan: vi.fn(() => mockSpan),
  addAttributes: vi.fn(),
  addEvent: vi.fn(),
}));

vi.mock('../../src/tracing/tracing.js', () => ({ default: mockTracing }));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn() })) },
}));

import {
  sqlTracingMiddleware,
  cacheTracingMiddleware,
  mongoTracingMiddleware,
} from '../../src/middleware/tracingMiddleware.js';

describe('tracingMiddleware helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sqlTracingMiddleware', () => {
    it('creates a span with query attributes', () => {
      mockTracing.createSpan.mockReturnValue(mockSpan);
      const span = sqlTracingMiddleware('SELECT 1', []);
      expect(mockTracing.createSpan).toHaveBeenCalledWith('SQL Query');
      expect(mockTracing.addAttributes).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
        'db.system': 'postgresql',
        'db.statement': 'SELECT 1',
      }));
      expect(mockTracing.addEvent).toHaveBeenCalledWith(mockSpan, 'sql.query.started');
      expect(span).toBe(mockSpan);
    });

    it('returns null when tracing has no span', () => {
      mockTracing.createSpan.mockReturnValue(null);
      const span = sqlTracingMiddleware('SELECT 1', []);
      expect(span).toBeNull();
      expect(mockTracing.addAttributes).not.toHaveBeenCalled();
    });
  });

  describe('cacheTracingMiddleware', () => {
    it('creates a span with cache attributes', () => {
      mockTracing.createSpan.mockReturnValue(mockSpan);
      const span = cacheTracingMiddleware('GET', 'key:1');
      expect(mockTracing.createSpan).toHaveBeenCalledWith('Redis GET');
      expect(mockTracing.addAttributes).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
        'cache.operation': 'GET',
        'cache.key': 'key:1',
      }));
      expect(span).toBe(mockSpan);
    });
  });

  describe('mongoTracingMiddleware', () => {
    it('creates a span with mongo attributes', () => {
      mockTracing.createSpan.mockReturnValue(mockSpan);
      const span = mongoTracingMiddleware('find', 'orders');
      expect(mockTracing.createSpan).toHaveBeenCalledWith('MongoDB find');
      expect(mockTracing.addAttributes).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
        'db.system': 'mongodb',
        'db.operation': 'find',
        'db.collection': 'orders',
      }));
      expect(span).toBe(mockSpan);
    });
  });
});
