import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import fs from 'fs';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { default: kedaService } = await import('../../../src/services/kedaService.js');

describe('services/kedaService.js Unit Tests', () => {
  const namespace = 'truxify-production';
  const deployment = 'api-service';
  const scaledObjectName = 'api-service-scaler';

  beforeEach(() => {
    vi.clearAllMocks();
    axios.get.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Scale-Up Triggers (getScaleRecommendation)', () => {
    it('scales up by +2 replicas when requests exceed 50 rps', async () => {
      vi.spyOn(kedaService, 'getAutoscalingMetrics').mockResolvedValue({
        success: true,
        requests: 75,
        latency: 50,
        cpu: 0.4,
        memory: 0.5,
        replicas: 4,
        timestamp: new Date().toISOString(),
      });

      const result = await kedaService.getScaleRecommendation(namespace, deployment);

      expect(result).toMatchObject({
        success: true,
        currentReplicas: 4,
        recommendedReplicas: 6, // 4 + 2
      });
      expect(result.metrics.requests).toBe(75);
    });

    it('scales up by +1 replica when CPU usage exceeds 70% (0.7)', async () => {
      vi.spyOn(kedaService, 'getAutoscalingMetrics').mockResolvedValue({
        success: true,
        requests: 30, // nominal
        latency: 45,
        cpu: 0.85, // > 0.7
        memory: 0.5,
        replicas: 3,
        timestamp: new Date().toISOString(),
      });

      const result = await kedaService.getScaleRecommendation(namespace, deployment);

      expect(result).toMatchObject({
        success: true,
        currentReplicas: 3,
        recommendedReplicas: 4, // 3 + 1
      });
    });

    it('scales up by +1 replica when Memory usage exceeds 80% (0.8)', async () => {
      vi.spyOn(kedaService, 'getAutoscalingMetrics').mockResolvedValue({
        success: true,
        requests: 25,
        latency: 40,
        cpu: 0.5,
        memory: 0.92, // > 0.8
        replicas: 5,
        timestamp: new Date().toISOString(),
      });

      const result = await kedaService.getScaleRecommendation(namespace, deployment);

      expect(result).toMatchObject({
        success: true,
        currentReplicas: 5,
        recommendedReplicas: 6, // 5 + 1
      });
    });

    it('compounds scale-up triggers when requests, CPU, and Memory all exceed thresholds', async () => {
      vi.spyOn(kedaService, 'getAutoscalingMetrics').mockResolvedValue({
        success: true,
        requests: 120, // > 50 (+2)
        latency: 200,
        cpu: 0.9, // > 0.7 (+1)
        memory: 0.85, // > 0.8 (+1)
        replicas: 6,
        timestamp: new Date().toISOString(),
      });

      const result = await kedaService.getScaleRecommendation(namespace, deployment);

      expect(result).toMatchObject({
        success: true,
        currentReplicas: 6,
        recommendedReplicas: 10, // 6 + 2 + 1 + 1 = 10
      });
    });

    it('caps recommended replicas at the maximum limit of 20', async () => {
      vi.spyOn(kedaService, 'getAutoscalingMetrics').mockResolvedValue({
        success: true,
        requests: 200,
        latency: 500,
        cpu: 0.95,
        memory: 0.95,
        replicas: 19,
        timestamp: new Date().toISOString(),
      });

      const result = await kedaService.getScaleRecommendation(namespace, deployment);

      expect(result).toMatchObject({
        success: true,
        currentReplicas: 19,
        recommendedReplicas: 20, // capped at 20 (not 19 + 4 = 23)
      });
    });
  });

  describe('Scale-Down Behavior (getScaleRecommendation)', () => {
    it('scales down by -1 replica when requests fall below 10 rps', async () => {
      vi.spyOn(kedaService, 'getAutoscalingMetrics').mockResolvedValue({
        success: true,
        requests: 4, // < 10
        latency: 15,
        cpu: 0.15,
        memory: 0.25,
        replicas: 5,
        timestamp: new Date().toISOString(),
      });

      const result = await kedaService.getScaleRecommendation(namespace, deployment);

      expect(result).toMatchObject({
        success: true,
        currentReplicas: 5,
        recommendedReplicas: 4, // 5 - 1
      });
    });

    it('enforces the minimum floor of 2 replicas during scale down', async () => {
      vi.spyOn(kedaService, 'getAutoscalingMetrics').mockResolvedValue({
        success: true,
        requests: 0,
        latency: 5,
        cpu: 0.05,
        memory: 0.1,
        replicas: 2,
        timestamp: new Date().toISOString(),
      });

      const result = await kedaService.getScaleRecommendation(namespace, deployment);

      expect(result).toMatchObject({
        success: true,
        currentReplicas: 2,
        recommendedReplicas: 2, // floor at 2 (not 2 - 1 = 1)
      });
    });
  });

  describe('Neutral Scaling (getScaleRecommendation)', () => {
    it('maintains the current replica count when metrics are in the nominal range', async () => {
      vi.spyOn(kedaService, 'getAutoscalingMetrics').mockResolvedValue({
        success: true,
        requests: 30, // 10 <= requests <= 50
        latency: 35,
        cpu: 0.55, // <= 0.7
        memory: 0.65, // <= 0.8
        replicas: 4,
        timestamp: new Date().toISOString(),
      });

      const result = await kedaService.getScaleRecommendation(namespace, deployment);

      expect(result).toMatchObject({
        success: true,
        currentReplicas: 4,
        recommendedReplicas: 4,
      });
    });
  });

  describe('Error Handling & Autoscaling Metrics Failure', () => {
    it('propagates failure when getAutoscalingMetrics returns success: false', async () => {
      const metricError = {
        success: false,
        error: 'One or more autoscaling metrics are unavailable',
        details: [{ error: 'Prometheus connection refused' }],
        timestamp: new Date().toISOString(),
      };
      vi.spyOn(kedaService, 'getAutoscalingMetrics').mockResolvedValue(metricError);

      const result = await kedaService.getScaleRecommendation(namespace, deployment);

      expect(result).toEqual(metricError);
    });

    it('returns failure in getAutoscalingMetrics when one of the Prometheus metric calls fails', async () => {
      vi.spyOn(kedaService, 'getAPIRequests').mockResolvedValue({ success: true, value: 20 });
      vi.spyOn(kedaService, 'getAPILatency').mockResolvedValue({ success: false, error: 'Latency metric error' });
      vi.spyOn(kedaService, 'getCPUUsage').mockResolvedValue({ success: true, value: 0.3 });
      vi.spyOn(kedaService, 'getMemoryUsage').mockResolvedValue({ success: true, value: 0.4 });
      vi.spyOn(kedaService, 'getReplicaCount').mockResolvedValue({ success: true, value: 3 });

      const result = await kedaService.getAutoscalingMetrics(namespace, deployment);

      expect(result.success).toBe(false);
      expect(result.error).toBe('One or more autoscaling metrics are unavailable');
      expect(result.details.length).toBe(1);
      expect(result.details[0].error).toBe('Latency metric error');
    });

    it('handles Prometheus network errors gracefully in getMetrics', async () => {
      axios.get.mockRejectedValueOnce(new Error('Network Error (ECONNREFUSED)'));

      const result = await kedaService.getMetrics('cpu_usage', 'sum(rate(container_cpu_usage...))');

      expect(result).toMatchObject({
        success: false,
        error: 'Network Error (ECONNREFUSED)',
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'KEDA_METRICS_FETCH_ERROR' }),
        'Metrics fetch failed'
      );
    });

    it('returns error when Prometheus responds with non-success status', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          status: 'error',
          error: 'execution timed out',
        },
      });

      const result = await kedaService.getMetrics('api_requests', 'sum(rate(istio_requests...))');

      expect(result).toMatchObject({
        success: false,
        metric: 'api_requests',
        error: 'execution timed out',
      });
    });

    it('handles exceptions in getCPUUsage gracefully', async () => {
      axios.get.mockRejectedValueOnce(new Error('Prometheus down'));

      const result = await kedaService.getCPUUsage(namespace, deployment);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Prometheus down');
    });

    it('handles exceptions in getMemoryUsage gracefully', async () => {
      axios.get.mockRejectedValueOnce(new Error('Prometheus timeout'));

      const result = await kedaService.getMemoryUsage(namespace, deployment);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Prometheus timeout');
    });

    it('handles exceptions in getReplicaCount gracefully', async () => {
      axios.get.mockRejectedValueOnce(new Error('Replica query error'));

      const result = await kedaService.getReplicaCount(namespace, deployment);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Replica query error');
    });
  });

  describe('KEDA API Interaction (getScaledObjectStatus & waitForScaledObjectStatus)', () => {
    it('validates namespace and scaledObjectName requirements', async () => {
      const res1 = await kedaService.getScaledObjectStatus('', 'test-obj');
      expect(res1).toMatchObject({ success: false, error: 'namespace is required' });

      const res2 = await kedaService.getScaledObjectStatus('test-ns', '');
      expect(res2).toMatchObject({ success: false, error: 'scaledObjectName is required' });
    });

    it('successfully fetches ScaledObject status via KEDA Kubernetes API', async () => {
      const mockScaledObject = {
        apiVersion: 'keda.sh/v1alpha1',
        kind: 'ScaledObject',
        metadata: { name: scaledObjectName, namespace },
        status: {
          scaleTargetGVKR: { group: 'apps', version: 'v1', kind: 'Deployment' },
          conditions: [
            { type: 'Ready', status: 'True', reason: 'ScaledObjectReady' },
            { type: 'Active', status: 'True', reason: 'ScalerActive' },
          ],
        },
      };

      axios.get.mockResolvedValueOnce({
        status: 200,
        data: mockScaledObject,
      });

      const result = await kedaService.getScaledObjectStatus(namespace, scaledObjectName);

      expect(result.success).toBe(true);
      expect(result.status.conditions[0].type).toBe('Ready');
      expect(result.data).toEqual(mockScaledObject);
      expect(axios.get).toHaveBeenCalledWith(
        `https://kubernetes.default.svc/apis/keda.sh/v1alpha1/namespaces/${namespace}/scaledobjects/${scaledObjectName}`,
        expect.any(Object)
      );
    });

    it('handles non-200 responses from KEDA Kubernetes API', async () => {
      axios.get.mockResolvedValueOnce({
        status: 503,
        data: { message: 'Service Unavailable' },
      });

      const result = await kedaService.getScaledObjectStatus(namespace, scaledObjectName);

      expect(result).toMatchObject({
        success: false,
        statusCode: 503,
        error: 'KEDA API returned HTTP 503',
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'KEDA_SCALED_OBJECT_STATUS_ERROR', statusCode: 503 }),
        'KEDA scaled object status request failed'
      );
    });

    it('enforces HTTPS when KEDA_API_TOKEN is configured in _kedaRequestConfig', () => {
      const originalUrl = kedaService.kedaApiUrl;
      const originalToken = kedaService.kedaApiToken;

      kedaService.kedaApiUrl = 'http://insecure-k8s.svc';
      kedaService.kedaApiToken = 'secret-token';

      expect(() => kedaService._kedaRequestConfig()).toThrow(
        'KEDA_API_URL must use HTTPS when KEDA_API_TOKEN is configured.'
      );

      kedaService.kedaApiUrl = originalUrl;
      kedaService.kedaApiToken = originalToken;
    });

    it('loads CA cert when HTTPS and cert file exists in _kedaRequestConfig', () => {
      const originalUrl = kedaService.kedaApiUrl;
      const originalToken = kedaService.kedaApiToken;
      const originalCertPath = kedaService.kedaCaCertPath;

      kedaService.kedaApiUrl = 'https://kubernetes.default.svc';
      kedaService.kedaApiToken = 'my-token';
      kedaService.kedaCaCertPath = '/tmp/fake-ca.crt';

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('FAKE_CERT_DATA');

      const config = kedaService._kedaRequestConfig();

      expect(config.headers.Authorization).toBe('Bearer my-token');
      expect(config.httpsAgent).toBeDefined();

      kedaService.kedaApiUrl = originalUrl;
      kedaService.kedaApiToken = originalToken;
      kedaService.kedaCaCertPath = originalCertPath;
    });

    it('waitForScaledObjectStatus succeeds immediately when initial status passes predicate', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          status: {
            conditions: [{ type: 'Active', status: 'True' }],
          },
        },
      });

      const predicate = (status) => status.conditions?.some((c) => c.type === 'Active' && c.status === 'True');
      const result = await kedaService.waitForScaledObjectStatus(namespace, scaledObjectName, predicate, {
        timeoutMs: 1000,
        intervalMs: 100,
      });

      expect(result.success).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('waitForScaledObjectStatus polls and succeeds on subsequent check', async () => {
      vi.useFakeTimers();

      axios.get
        .mockResolvedValueOnce({
          status: 200,
          data: { status: { conditions: [{ type: 'Ready', status: 'False' }] } },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: { status: { conditions: [{ type: 'Ready', status: 'True' }] } },
        });

      const predicate = (status) => status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True');

      const promise = kedaService.waitForScaledObjectStatus(namespace, scaledObjectName, predicate, {
        timeoutMs: 2000,
        intervalMs: 200,
      });

      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('waitForScaledObjectStatus times out when predicate is never satisfied', async () => {
      vi.useFakeTimers();

      axios.get.mockResolvedValue({
        status: 200,
        data: { status: { conditions: [{ type: 'Ready', status: 'False' }] } },
      });

      const promise = kedaService.waitForScaledObjectStatus(namespace, scaledObjectName, () => false, {
        timeoutMs: 300,
        intervalMs: 100,
      });

      await vi.advanceTimersByTimeAsync(350);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(result.error).toContain('Timed out waiting for KEDA scaled object status');
    });
  });

  describe('PromQL Query Methods & Sanitization', () => {
    it('queries API and ML request metrics correctly', async () => {
      axios.get.mockResolvedValue({
        data: {
          status: 'success',
          data: { result: [{ value: [1710000000, '48.5'] }] },
        },
      });

      const apiReq = await kedaService.getAPIRequests();
      expect(apiReq).toMatchObject({ success: true, metric: 'api_requests', value: 48.5 });

      const mlReq = await kedaService.getMLEngineRequests();
      expect(mlReq).toMatchObject({ success: true, metric: 'ml_requests', value: 48.5 });

      const apiLat = await kedaService.getAPILatency();
      expect(apiLat).toMatchObject({ success: true, metric: 'api_latency', value: 48.5 });
    });

    it('queries Kafka lag with sanitized topics and consumer groups', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          status: 'success',
          data: { result: [{ value: [1710000000, '12'] }] },
        },
      });

      const result = await kedaService.getKafkaLag('orders.v1;DROP', 'order-processor!@#');

      expect(result).toMatchObject({
        success: true,
        topic: 'orders.v1DROP',
        consumerGroup: 'order-processor',
        lag: 12,
      });
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/query'),
        expect.objectContaining({
          params: {
            query: 'sum(kafka_consumergroup_lag{topic="orders.v1DROP",consumergroup="order-processor"})',
          },
        })
      );
    });

    it('returns config details in getStats()', async () => {
      const stats = await kedaService.getStats();

      expect(stats).toMatchObject({
        kafkaLagMetric: expect.any(String),
        prometheusConfigured: expect.any(Boolean),
        kafkaBootstrapConfigured: expect.any(Boolean),
        timestamp: expect.any(String),
      });
    });
  });
});
