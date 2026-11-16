import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  listConsumerGroupOffsets: vi.fn(),
}));

vi.mock('kafkajs', () => ({
  Kafka: vi.fn(function () {
    return {
      admin: () => ({
        connect: mocks.connect,
        disconnect: mocks.disconnect,
        listConsumerGroupOffsets: mocks.listConsumerGroupOffsets,
      }),
    };
  }),
}));

vi.mock('@opentelemetry/api', () => ({
  context: { active: vi.fn(), with: vi.fn() },
  propagation: { inject: vi.fn(), extract: vi.fn() },
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import kafkaConfig from '../config/kafka.config.js';

describe('KafkaConfig.getConsumerGroupOffsets', () => {
  beforeEach(() => {
    mocks.connect.mockReset().mockResolvedValue(undefined);
    mocks.disconnect.mockReset().mockResolvedValue(undefined);
    mocks.listConsumerGroupOffsets.mockReset();
  });

  it('disconnects the admin client after a successful lookup', async () => {
    const offsets = { topics: [] };
    mocks.listConsumerGroupOffsets.mockResolvedValue(offsets);

    await expect(kafkaConfig.getConsumerGroupOffsets('orders')).resolves.toBe(offsets);

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.listConsumerGroupOffsets).toHaveBeenCalledWith('orders');
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects the admin client and propagates lookup failures', async () => {
    const lookupError = new Error('broker unavailable');
    mocks.listConsumerGroupOffsets.mockRejectedValue(lookupError);

    await expect(kafkaConfig.getConsumerGroupOffsets('orders')).rejects.toBe(lookupError);

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });
});
