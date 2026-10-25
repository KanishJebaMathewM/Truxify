import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const relayRun = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const relayCtor = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

vi.mock('../config/kafka.config.js', () => ({
  default: { connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}), publishEvent: vi.fn() },
}));
vi.mock('../events/order.events.js', () => ({ default: {} }));
vi.mock('../consumers/order.consumer.js', () => ({
  default: { initialize: vi.fn(async () => {}), registerHandler: vi.fn(), startAllConsumers: vi.fn(async () => {}) },
}));
vi.mock('../cqrs/order.read.model.js', () => ({ default: { buildReadModel: vi.fn() } }));
vi.mock('../../api/src/middleware/logger.js', () => ({ default: logger }));
vi.mock('../relay/outboxRelay.js', () => ({ startOutboxRelay: vi.fn(), stopOutboxRelay: vi.fn() }));
vi.mock('../repositories/outbox.repository.js', () => ({ default: { claimPending: vi.fn() } }));
vi.mock('../relay/outbox.relay.js', () => ({
  OutboxRelay: vi.fn(function (opts) {
    relayCtor(opts);
    this.run = relayRun;
    this.stop = vi.fn();
  }),
}));

describe('kafka service startup', () => {
  let exitSpy;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    vi.stubEnv('OUTBOX_RELAY_INTERVAL_MS', '1234');
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('starts the event_outbox relay with its repository instead of exiting', async () => {
    await import('../index.js');
    await vi.waitFor(() => expect(relayRun).toHaveBeenCalled());

    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalledWith('❌ Failed to start Kafka services:', expect.anything());
    expect(relayCtor.mock.calls[0][0].repository).toBeDefined();
    expect(relayRun).toHaveBeenCalledWith({ intervalMs: 1234 });
  });
});
