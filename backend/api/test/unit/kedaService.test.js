import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const { default: kedaService } = await import('../../src/services/kedaService.js');

describe('kedaService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries Prometheus for Kafka lag instead of fabricating a random value', async () => {
    axios.get.mockResolvedValue({
      data: {
        status: 'success',
        data: {
          result: [{ value: [1710000000, '42'] }],
        },
      },
    });

    const result = await kedaService.getKafkaLag('order.created;drop', 'order-service/bad');

    expect(result).toMatchObject({
      success: true,
      topic: 'order.createddrop',
      consumerGroup: 'order-servicebad',
      lag: 42,
    });
    expect(axios.get).toHaveBeenCalledWith(
      'http://prometheus.istio-system:9090/api/v1/query',
      expect.objectContaining({
        params: {
          query: 'sum(kafka_consumergroup_lag{topic="order.createddrop",consumergroup="order-servicebad"})',
        },
        timeout: 5000,
      }),
    );
  });

  it('fails closed when Prometheus cannot return Kafka lag', async () => {
    axios.get.mockRejectedValue(new Error('prometheus unavailable'));

    const result = await kedaService.getKafkaLag('ml.predictions', 'ml-service');

    expect(result).toMatchObject({
      success: false,
      error: 'prometheus unavailable',
      topic: 'ml.predictions',
      consumerGroup: 'ml-service',
    });
  });

  it('strips regex metacharacters from deployment selectors', async () => {
    axios.get.mockResolvedValue({
      data: {
        status: 'success',
        data: {
          result: [{ value: [1710000000, '0.25'] }],
        },
      },
    });

    const result = await kedaService.getCPUUsage('truxify', 'api.v1');

    expect(result).toMatchObject({
      success: true,
      metric: 'cpu_usage',
      value: 0.25,
    });
    expect(axios.get).toHaveBeenCalledWith(
      'http://prometheus.istio-system:9090/api/v1/query',
      expect.objectContaining({
        params: {
          query: 'sum(rate(container_cpu_usage_seconds_total{namespace="truxify",pod=~"apiv1-.*"}[5m]))',
        },
      }),
    );
  });
});
