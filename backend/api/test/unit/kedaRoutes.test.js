import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const kedaServiceMock = vi.hoisted(() => ({
  getAPIRequests: vi.fn(),
  getAPILatency: vi.fn(),
  getCPUUsage: vi.fn(),
  getMemoryUsage: vi.fn(),
  getKafkaLag: vi.fn(),
  getAutoscalingMetrics: vi.fn(),
  getScaleRecommendation: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock('../../src/services/kedaService.js', () => ({
  default: kedaServiceMock,
}));

const { default: kedaRouter } = await import('../../src/routes/kedaRoutes.js');

function makeApp() {
  const app = express();
  app.use('/api', kedaRouter);
  return app;
}

describe('kedaRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /keda/metrics/requests returns request metrics', async () => {
    kedaServiceMock.getAPIRequests.mockResolvedValue({ success: true, count: 42 });
    const res = await request(makeApp()).get('/api/keda/metrics/requests');
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(42);
  });

  it('GET /keda/metrics/requests returns 502 when the service fails', async () => {
    kedaServiceMock.getAPIRequests.mockResolvedValue({ success: false, error: 'down' });
    const res = await request(makeApp()).get('/api/keda/metrics/requests');
    expect(res.status).toBe(502);
  });

  it('GET /keda/metrics/cpu requires namespace and deployment', async () => {
    const res = await request(makeApp()).get('/api/keda/metrics/cpu');
    expect(res.status).toBe(400);
  });

  it('GET /keda/metrics/cpu returns cpu usage', async () => {
    kedaServiceMock.getCPUUsage.mockResolvedValue({ success: true, cpu: 0.5 });
    const res = await request(makeApp()).get('/api/keda/metrics/cpu?namespace=ns&deployment=dep');
    expect(res.status).toBe(200);
    expect(kedaServiceMock.getCPUUsage).toHaveBeenCalledWith('ns', 'dep');
  });

  it('GET /keda/metrics/memory returns memory usage', async () => {
    kedaServiceMock.getMemoryUsage.mockResolvedValue({ success: true, memory: 128 });
    const res = await request(makeApp()).get('/api/keda/metrics/memory?namespace=ns&deployment=dep');
    expect(res.status).toBe(200);
    expect(kedaServiceMock.getMemoryUsage).toHaveBeenCalledWith('ns', 'dep');
  });

  it('GET /keda/metrics/kafka-lag requires topic and consumerGroup', async () => {
    const res = await request(makeApp()).get('/api/keda/metrics/kafka-lag');
    expect(res.status).toBe(400);
  });

  it('GET /keda/metrics/kafka-lag returns lag metrics', async () => {
    kedaServiceMock.getKafkaLag.mockResolvedValue({ success: true, lag: 100 });
    const res = await request(makeApp()).get('/api/keda/metrics/kafka-lag?topic=t&consumerGroup=cg');
    expect(res.status).toBe(200);
    expect(kedaServiceMock.getKafkaLag).toHaveBeenCalledWith('t', 'cg');
  });

  it('GET /keda/scale/recommend returns a recommendation', async () => {
    kedaServiceMock.getScaleRecommendation.mockResolvedValue({ success: true, replicas: 3 });
    const res = await request(makeApp()).get('/api/keda/scale/recommend?namespace=ns&deployment=dep');
    expect(res.status).toBe(200);
    expect(res.body.data.replicas).toBe(3);
  });

  it('GET /keda/stats returns stats', async () => {
    kedaServiceMock.getStats.mockResolvedValue({ requests: 1 });
    const res = await request(makeApp()).get('/api/keda/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.requests).toBe(1);
  });

  it('returns 500 when the service throws', async () => {
    kedaServiceMock.getStats.mockRejectedValue(new Error('boom'));
    const res = await request(makeApp()).get('/api/keda/stats');
    expect(res.status).toBe(500);
  });
});
