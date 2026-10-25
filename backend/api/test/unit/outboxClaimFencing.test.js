import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  publish: vi.fn(),
}));
vi.mock('../../src/config/db.js', () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock('../../src/middleware/logger.js', () => ({ default: mocks.logger }));
vi.mock('../../src/core/events/index.js', () => ({ eventBus: { publishAndReport: mocks.publish } }));
vi.mock('../../src/services/webhook/dlqService.js', () => ({ getWorkerId: () => 'worker-A' }));
import { OutboxService, outboxService } from '../../src/services/outbox/outboxService.js';
import { startOutboxRelayWorker, stopOutboxRelayWorker } from '../../src/workers/outboxRelayWorker.js';

const delivered = { published: true, deduplicated: false, adapterAttempted: 1, adapterFailures: 0, adapterErrors: [] };
const event = { event_id: 'durable-1', attempts: 2, event_type: 'order.created', aggregate_id: 'order-1', payload: {} };
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.publish.mockResolvedValue(delivered);
});
afterEach(() => { stopOutboxRelayWorker(); vi.useRealTimers(); });

describe('outbox claim protocol adapter', () => {
  it('forwards configured lease and limit to the leased claim RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: [event], error: null });
    expect(await new OutboxService().claimBatch({ batchSize: 7, leaseMs: 90000 })).toEqual([event]);
    expect(mocks.rpc).toHaveBeenCalledWith('claim_leased_outbox_events', { p_limit: 7, p_lease_ms: 90000 });
  });
  it('fails closed when claim RPC is unavailable', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'migration missing' } });
    expect(await new OutboxService().claimBatch()).toEqual([]);
  });
  it('success settlement carries its exact generation', async () => {
    expect(await new OutboxService().markPublished('durable-1', 2)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('settle_leased_outbox_event', expect.objectContaining({
      p_event_id: 'durable-1', p_claim_attempt: 2, p_published: true, p_error: null,
    }));
  });
  it('failed settlement schedules a bounded retry without a second attempt increment', async () => {
    expect(await new OutboxService().markFailed('durable-1', 'worker-A', 'broker down', 3)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('settle_leased_outbox_event', {
      p_event_id: 'durable-1', p_claim_attempt: 3, p_published: false, p_error: 'broker down', p_retry_ms: 4000,
    });
  });
  it.each([undefined, 0, -1, '2', 1.5])('refuses missing/invalid generation %s', async attempt => {
    expect(await new OutboxService().markPublished('durable-1', attempt)).toBe(false);
    expect(await new OutboxService().markFailed('durable-1', 'worker-A', 'err', attempt)).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([false, null, 'true'])('does not report rejected settlement %s as accepted', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await new OutboxService().markPublished('durable-1', 2)).toBe(false);
  });
  it('reports settlement database errors as unacknowledged', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db down' } });
    expect(await new OutboxService().markPublished('durable-1', 2)).toBe(false);
  });
  it('renewal carries generation and configured lease', async () => {
    expect(await new OutboxService().renewClaim('durable-1', 2, 90000)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('renew_leased_outbox_event', { p_event_id: 'durable-1', p_claim_attempt: 2, p_lease_ms: 90000 });
  });
});

async function cycle({ renew = true, accepted = true } = {}) {
  vi.useFakeTimers();
  vi.spyOn(outboxService, 'deadLetterExhaustedEvents').mockResolvedValue();
  const requeue = vi.spyOn(outboxService, 'requeueFailedEvents').mockResolvedValue();
  vi.spyOn(outboxService, 'claimBatch').mockResolvedValue([event]);
  vi.spyOn(outboxService, 'renewClaim').mockResolvedValue(renew);
  const success = vi.spyOn(outboxService, 'markPublished').mockResolvedValue(accepted);
  const failure = vi.spyOn(outboxService, 'markFailed').mockResolvedValue(accepted);
  startOutboxRelayWorker();
  await vi.advanceTimersByTimeAsync(0);
  stopOutboxRelayWorker();
  return { requeue, success, failure };
}

describe('actual relay ownership integration', () => {
  it('does not reset live claims and forwards generation to acknowledgement', async () => {
    const spies = await cycle();
    expect(spies.requeue).not.toHaveBeenCalled();
    expect(spies.success).toHaveBeenCalledWith('durable-1', 2);
    const [base, , options] = mocks.publish.mock.calls[0];
    expect(base.eventId).toBe('durable-1');
    expect(options).toEqual({ adapters: ['kafka'], deduplicate: false });
  });
  it('skips dispatch and settlement after claim renewal is rejected', async () => {
    const spies = await cycle({ renew: false });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(spies.success).not.toHaveBeenCalled();
    expect(spies.failure).not.toHaveBeenCalled();
  });
  it('does not log a rejected success as published', async () => {
    await cycle({ accepted: false });
    expect(mocks.logger.info.mock.calls.some(call => call[0] === '[OutboxRelay] Published event:')).toBe(false);
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('acknowledgement was rejected'), expect.any(Object));
  });
  it('passes generation after a delivery exception', async () => {
    mocks.publish.mockRejectedValue(new Error('broker down'));
    const spies = await cycle();
    expect(spies.failure).toHaveBeenCalledWith('durable-1', 'worker-A', 'broker down', 2);
  });
  it('passes generation when no adapter received the event', async () => {
    mocks.publish.mockResolvedValue({ ...delivered, adapterAttempted: 0 });
    const spies = await cycle();
    expect(spies.failure).toHaveBeenCalledWith('durable-1', 'worker-A', expect.stringContaining('No event consumer'), 2);
  });
});
