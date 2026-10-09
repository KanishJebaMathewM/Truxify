import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  createTopics: vi.fn(),
  disconnect: vi.fn(),
  admin: vi.fn(),
}));

vi.mock('kafkajs', () => ({
  Kafka: vi.fn(function () {
    return {
      admin: mocks.admin,
      producer: vi.fn(),
      consumer: vi.fn(),
    };
  }),
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

describe('KafkaConfig.createTopics admin cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admin.mockReturnValue({
      connect: mocks.connect,
      createTopics: mocks.createTopics,
      disconnect: mocks.disconnect,
    });
  });

  it('disconnects the admin client after successful topic creation', async () => {
    mocks.createTopics.mockResolvedValue(true);

    await expect(kafkaConfig.createTopics()).resolves.toBeUndefined();

    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.createTopics).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it('disconnects the admin client and preserves the error when topic creation fails', async () => {
    const creationError = new Error('broker unavailable');
    mocks.createTopics.mockRejectedValue(creationError);

    await expect(kafkaConfig.createTopics()).rejects.toBe(creationError);

    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.createTopics).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
});
