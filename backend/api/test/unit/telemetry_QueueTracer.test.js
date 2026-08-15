/**
 * Unit tests for backend/api/src/core/telemetry/QueueTracer.js
 *
 * Coverage:
 *   - constructor: initializes with service name
 *   - traceEnqueue / traceDequeue / traceAck: create spans
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStartSpan = vi.fn(() => ({ setStatus: vi.fn(), end: vi.fn(), setAttributes: vi.fn(), setAttribute: vi.fn() }));
vi.mock('@opentelemetry/api', () => ({ context: { active: vi.fn(() => ({})) }, trace: { getTracer: vi.fn(() => ({ startSpan: mockStartSpan })) }, SpanStatusCode: { OK: 0, ERROR: 1 } }));

const QueueTracer = (await import('../../src/core/telemetry/QueueTracer.js')).QueueTracer;

describe('QueueTracer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('constructor', () => {
    it('initializes with service name', () => { expect(new QueueTracer('queue-service')).toBeTruthy(); });
  });

  describe('traceEnqueue', () => {
    it('creates enqueue span', () => {
      new QueueTracer('queue-service').traceEnqueue('queue:orders', { orderId: '123' });
      expect(mockStartSpan).toHaveBeenCalledWith('queue.enqueue', expect.anything());
    });
  });

  describe('traceDequeue', () => {
    it('creates dequeue span', () => {
      new QueueTracer('queue-service').traceDequeue('queue:orders', { messageId: 'msg-1' });
      expect(mockStartSpan).toHaveBeenCalledWith('queue.dequeue', expect.anything());
    });
  });

  describe('traceAck', () => {
    it('creates acknowledge span', () => {
      new QueueTracer('queue-service').traceAck('queue:orders', { messageId: 'msg-1' });
      expect(mockStartSpan).toHaveBeenCalledWith('queue.ack', expect.anything());
    });
  });
});
