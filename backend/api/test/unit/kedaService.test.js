import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}))

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}))

const { default: kedaService } =
  await import('../../src/services/kedaService.js')

const namespace = 'truxify-production'
const scaledObjectName = 'api-scaled-object'
const scaledObjectResponse = {
  apiVersion: 'keda.sh/v1alpha1',
  kind: 'ScaledObject',
  metadata: { name: scaledObjectName, namespace },
  status: {
    conditions: [
      { type: 'Ready', status: 'True', reason: 'ScaledObjectReady' },
      { type: 'Active', status: 'True', reason: 'ScalerActive' },
    ],
    health: { apiScaler: { numberOfFailures: 0, status: 'Happy' } },
  },
}

function expectTimestamp(result) {
  expect(result.timestamp).toEqual(expect.any(String))
  expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false)
}

function expectKedaRequest() {
  expect(axios.get).toHaveBeenCalledWith(
    `https://kubernetes.default.svc/apis/keda.sh/v1alpha1/namespaces/${namespace}/scaledobjects/${scaledObjectName}`,
    expect.objectContaining({ timeout: 5000 }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  axios.get.mockReset()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('KEDAService.getScaledObjectStatus', () => {
  it('returns a validation error for a missing namespace', async () => {
    const result = await kedaService.getScaledObjectStatus(
      undefined,
      scaledObjectName,
    )

    expect(result).toMatchObject({
      success: false,
      error: 'namespace is required',
    })
    expectTimestamp(result)
    expect(axios.get).not.toHaveBeenCalled()
  })

  it.each([null, '', '   '])(
    'rejects an empty namespace value: %p',
    async (emptyNamespace) => {
      const result = await kedaService.getScaledObjectStatus(
        emptyNamespace,
        scaledObjectName,
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('namespace is required')
      expect(axios.get).not.toHaveBeenCalled()
    },
  )

  it('returns a validation error for a missing scaled object name', async () => {
    const result = await kedaService.getScaledObjectStatus(namespace, undefined)

    expect(result).toMatchObject({
      success: false,
      error: 'scaledObjectName is required',
    })
    expectTimestamp(result)
    expect(axios.get).not.toHaveBeenCalled()
  })

  it('rejects whitespace-only scaled object names', async () => {
    const result = await kedaService.getScaledObjectStatus(namespace, '  ')

    expect(result.success).toBe(false)
    expect(result.error).toBe('scaledObjectName is required')
    expect(axios.get).not.toHaveBeenCalled()
  })

  it('requests and parses a successful scaled object response', async () => {
    axios.get.mockResolvedValue({ status: 200, data: scaledObjectResponse })

    const result = await kedaService.getScaledObjectStatus(
      namespace,
      scaledObjectName,
    )

    expect(result).toMatchObject({
      success: true,
      status: scaledObjectResponse.status,
      data: scaledObjectResponse,
    })
    expectTimestamp(result)
    expectKedaRequest()
  })

  it('trims and URL-encodes namespace and scaled object name', async () => {
    axios.get.mockResolvedValue({ status: 200, data: scaledObjectResponse })

    await kedaService.getScaledObjectStatus(' team namespace ', 'api/object')

    expect(axios.get).toHaveBeenCalledWith(
      'https://kubernetes.default.svc/apis/keda.sh/v1alpha1/namespaces/team%20namespace/scaledobjects/api%2Fobject',
      { timeout: 5000 },
    )
  })

  it.each([201, 202, 204, 400, 404, 500])(
    'returns an error result for HTTP status %s',
    async (status) => {
      axios.get.mockResolvedValue({
        status,
        data: { message: 'KEDA response' },
      })

      const result = await kedaService.getScaledObjectStatus(
        namespace,
        scaledObjectName,
      )

      expect(result).toMatchObject({
        success: false,
        statusCode: status,
        error: `KEDA API returned HTTP ${status}`,
      })
      expectTimestamp(result)
      expect(mockLogger.error).toHaveBeenCalledWith(
        { event: 'KEDA_SCALED_OBJECT_STATUS_ERROR', statusCode: status },
        'KEDA scaled object status request failed',
      )
    },
  )

  it('handles a timeout without throwing', async () => {
    axios.get.mockRejectedValue({
      code: 'ECONNABORTED',
      message: 'timeout of 5000ms exceeded',
    })

    const result = await kedaService.getScaledObjectStatus(
      namespace,
      scaledObjectName,
    )

    expect(result).toMatchObject({
      success: false,
      error: 'timeout of 5000ms exceeded',
    })
    expectTimestamp(result)
    expect(mockLogger.error).toHaveBeenCalledWith(
      {
        event: 'KEDA_SCALED_OBJECT_STATUS_ERROR',
        error: 'timeout of 5000ms exceeded',
      },
      'KEDA scaled object status request failed',
    )
  })

  it('preserves the HTTP status from a rejected Axios response', async () => {
    axios.get.mockRejectedValue({
      message: 'Request failed with status code 404',
      response: { status: 404 },
    })

    const result = await kedaService.getScaledObjectStatus(
      namespace,
      scaledObjectName,
    )

    expect(result).toMatchObject({
      success: false,
      error: 'Request failed with status code 404',
      statusCode: 404,
    })
  })

  it('rejects token-bearing HTTP endpoints before making a request', async () => {
    const originalUrl = kedaService.kedaApiUrl
    const originalToken = kedaService.kedaApiToken
    kedaService.kedaApiUrl = 'http://kubernetes.default.svc'
    kedaService.kedaApiToken = 'test-service-account-token'

    const result = await kedaService.getScaledObjectStatus(
      namespace,
      scaledObjectName,
    )

    expect(result).toMatchObject({
      success: false,
      error: 'KEDA_API_URL must use HTTPS when KEDA_API_TOKEN is configured.',
    })
    expect(axios.get).not.toHaveBeenCalled()
    kedaService.kedaApiUrl = originalUrl
    kedaService.kedaApiToken = originalToken
  })

  it('normalizes an unknown thrown value into a string error', async () => {
    axios.get.mockRejectedValue('connection reset')

    const result = await kedaService.getScaledObjectStatus(
      namespace,
      scaledObjectName,
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('connection reset')
    expectTimestamp(result)
  })

  it('includes a bearer token when KEDA authentication is configured', async () => {
    const originalToken = kedaService.kedaApiToken
    kedaService.kedaApiToken = 'test-service-account-token'
    axios.get.mockResolvedValue({ status: 200, data: scaledObjectResponse })

    await kedaService.getScaledObjectStatus(namespace, scaledObjectName)

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/namespaces/truxify-production/'),
      expect.objectContaining({
        timeout: 5000,
        headers: { Authorization: 'Bearer test-service-account-token' },
      }),
    )
    kedaService.kedaApiToken = originalToken
  })
})

describe('KEDAService.waitForScaledObjectStatus', () => {
  it('returns immediately when the first status satisfies the predicate', async () => {
    axios.get.mockResolvedValue({ status: 200, data: scaledObjectResponse })
    const predicate = vi.fn(() => true)

    const result = await kedaService.waitForScaledObjectStatus(
      namespace,
      scaledObjectName,
      predicate,
      { intervalMs: 50, timeoutMs: 500 },
    )

    expect(result).toMatchObject({
      success: true,
      timedOut: false,
      status: scaledObjectResponse.status,
    })
    expect(predicate).toHaveBeenCalledWith(
      scaledObjectResponse.status,
      expect.any(Object),
    )
    expect(axios.get).toHaveBeenCalledTimes(1)
  })

  it('polls at the configured interval until the predicate succeeds', async () => {
    vi.useFakeTimers()
    axios.get
      .mockResolvedValueOnce({
        status: 200,
        data: { status: { conditions: [] } },
      })
      .mockResolvedValueOnce({ status: 200, data: scaledObjectResponse })
    const predicate = vi.fn((status) =>
      status.conditions?.some((condition) => condition.type === 'Ready'),
    )

    const pending = kedaService.waitForScaledObjectStatus(
      namespace,
      scaledObjectName,
      predicate,
      { intervalMs: 100, timeoutMs: 500 },
    )
    await vi.advanceTimersByTimeAsync(100)
    const result = await pending

    expect(result.success).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(axios.get).toHaveBeenCalledTimes(2)
    expect(predicate).toHaveBeenCalledTimes(2)
  })

  it('returns a timed-out result when the predicate never succeeds', async () => {
    vi.useFakeTimers()
    axios.get.mockResolvedValue({
      status: 200,
      data: { status: { conditions: [{ type: 'Ready', status: 'False' }] } },
    })

    const pending = kedaService.waitForScaledObjectStatus(
      namespace,
      scaledObjectName,
      () => false,
      { intervalMs: 100, timeoutMs: 250 },
    )
    await vi.advanceTimersByTimeAsync(300)
    const result = await pending

    expect(result).toMatchObject({
      success: false,
      timedOut: true,
      error: 'Timed out waiting for KEDA scaled object status',
    })
    expect(axios.get).toHaveBeenCalledTimes(3)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ namespace, scaledObjectName, timeoutMs: 250 }),
      'Timed out waiting for KEDA scaled object status',
    )
  })

  it('continues polling after a transient request failure', async () => {
    vi.useFakeTimers()
    axios.get
      .mockRejectedValueOnce(new Error('temporary KEDA outage'))
      .mockResolvedValueOnce({ status: 200, data: scaledObjectResponse })

    const pending = kedaService.waitForScaledObjectStatus(
      namespace,
      scaledObjectName,
      () => true,
      { intervalMs: 25, timeoutMs: 100 },
    )
    await vi.advanceTimersByTimeAsync(25)
    const result = await pending

    expect(result.success).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(axios.get).toHaveBeenCalledTimes(2)
  })

  it('uses the service polling defaults when options are omitted', async () => {
    const originalInterval = kedaService.kedaPollInterval
    const originalTimeout = kedaService.kedaPollTimeout
    kedaService.kedaPollInterval = 1
    kedaService.kedaPollTimeout = 1
    axios.get.mockResolvedValue({ status: 200, data: scaledObjectResponse })

    const result = await kedaService.waitForScaledObjectStatus(
      namespace,
      scaledObjectName,
      () => true,
    )

    expect(result.success).toBe(true)
    kedaService.kedaPollInterval = originalInterval
    kedaService.kedaPollTimeout = originalTimeout
  })
})

describe('KEDAService Prometheus helpers', () => {
  it('queries Prometheus for Kafka lag after sanitizing input', async () => {
    axios.get.mockResolvedValue({
      data: {
        status: 'success',
        data: { result: [{ value: [1710000000, '42'] }] },
      },
    })

    const result = await kedaService.getKafkaLag(
      'order.created;drop',
      'order-service/bad',
    )

    expect(result).toMatchObject({
      success: true,
      topic: 'order.createddrop',
      consumerGroup: 'order-servicebad',
      lag: 42,
    })
    expect(axios.get).toHaveBeenCalledWith(
      'http://prometheus.istio-system:9090/api/v1/query',
      expect.objectContaining({
        params: {
          query:
            'sum(kafka_consumergroup_lag{topic="order.createddrop",consumergroup="order-servicebad"})',
        },
        timeout: 5000,
      }),
    )
  })

  it('fails closed when Prometheus cannot return Kafka lag', async () => {
    axios.get.mockRejectedValue(new Error('prometheus unavailable'))

    const result = await kedaService.getKafkaLag('ml.predictions', 'ml-service')

    expect(result).toMatchObject({
      success: false,
      error: 'prometheus unavailable',
      topic: 'ml.predictions',
      consumerGroup: 'ml-service',
    })
  })

  it('strips regex metacharacters from deployment selectors', async () => {
    axios.get.mockResolvedValue({
      data: {
        status: 'success',
        data: { result: [{ value: [1710000000, '0.25'] }] },
      },
    })

    const result = await kedaService.getCPUUsage('truxify', 'api.v1')

    expect(result).toMatchObject({
      success: true,
      metric: 'cpu_usage',
      value: 0.25,
    })
    expect(axios.get).toHaveBeenCalledWith(
      'http://prometheus.istio-system:9090/api/v1/query',
      expect.objectContaining({
        params: {
          query:
            'sum(rate(container_cpu_usage_seconds_total{namespace="truxify",pod=~"apiv1-.*"}[5m]))',
        },
      }),
    )
  })

  it('returns a failed metric result for a non-success Prometheus response', async () => {
    axios.get.mockResolvedValue({
      data: { status: 'error', error: 'bad query' },
    })

    const result = await kedaService.getMetrics('api_requests', 'bad query')

    expect(result).toMatchObject({
      success: false,
      metric: 'api_requests',
      error: 'bad query',
    })
    expectTimestamp(result)
  })

  it('returns zero when Prometheus returns no samples', async () => {
    axios.get.mockResolvedValue({
      data: { status: 'success', data: { result: [] } },
    })

    const result = await kedaService.getMetrics('replica_count', 'query')

    expect(result).toMatchObject({
      success: true,
      metric: 'replica_count',
      value: 0,
    })
  })

  it('combines successful autoscaling metrics', async () => {
    vi.spyOn(kedaService, 'getAPIRequests').mockResolvedValue({
      success: true,
      value: 60,
    })
    vi.spyOn(kedaService, 'getAPILatency').mockResolvedValue({
      success: true,
      value: 120,
    })
    vi.spyOn(kedaService, 'getCPUUsage').mockResolvedValue({
      success: true,
      value: 0.5,
    })
    vi.spyOn(kedaService, 'getMemoryUsage').mockResolvedValue({
      success: true,
      value: 0.4,
    })
    vi.spyOn(kedaService, 'getReplicaCount').mockResolvedValue({
      success: true,
      value: 3,
    })

    const result = await kedaService.getAutoscalingMetrics(namespace, 'api')

    expect(result).toMatchObject({
      success: true,
      requests: 60,
      latency: 120,
      cpu: 0.5,
      memory: 0.4,
      replicas: 3,
    })
    expectTimestamp(result)
  })

  it('fails autoscaling metrics when one provider fails', async () => {
    vi.spyOn(kedaService, 'getAPIRequests').mockResolvedValue({
      success: true,
      value: 1,
    })
    vi.spyOn(kedaService, 'getAPILatency').mockResolvedValue({
      success: false,
      error: 'latency unavailable',
    })
    vi.spyOn(kedaService, 'getCPUUsage').mockResolvedValue({
      success: true,
      value: 0.2,
    })
    vi.spyOn(kedaService, 'getMemoryUsage').mockResolvedValue({
      success: true,
      value: 0.2,
    })
    vi.spyOn(kedaService, 'getReplicaCount').mockResolvedValue({
      success: true,
      value: 2,
    })

    const result = await kedaService.getAutoscalingMetrics(namespace, 'api')

    expect(result).toMatchObject({
      success: false,
      error: 'One or more autoscaling metrics are unavailable',
      details: [{ error: 'latency unavailable' }],
    })
    expectTimestamp(result)
  })

  it('calculates a scale recommendation from high request and resource load', async () => {
    vi.spyOn(kedaService, 'getAutoscalingMetrics').mockResolvedValue({
      success: true,
      requests: 100,
      latency: 10,
      cpu: 0.8,
      memory: 0.9,
      replicas: 5,
    })

    const result = await kedaService.getScaleRecommendation(namespace, 'api')

    expect(result).toMatchObject({
      success: true,
      currentReplicas: 5,
      recommendedReplicas: 9,
    })
    expectTimestamp(result)
  })

  it('returns metric failure details when recommendation inputs fail', async () => {
    const failure = { success: false, error: 'metrics unavailable' }
    vi.spyOn(kedaService, 'getAutoscalingMetrics').mockResolvedValue(failure)

    await expect(
      kedaService.getScaleRecommendation(namespace, 'api'),
    ).resolves.toBe(failure)
  })
})

describe('KEDAService active workload and queue metrics', () => {
  it('generates active orders metric from database count', async () => {
    const mockDb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({ count: 42, error: null }),
        })),
      })),
    }

    const result = await kedaService.getActiveOrders(mockDb)

    expect(result).toMatchObject({
      success: true,
      metric: 'active_orders',
      value: 42,
    })
    expectTimestamp(result)
    expect(mockDb.from).toHaveBeenCalledWith('orders')
  })

  it('handles database errors gracefully when fetching active orders', async () => {
    const mockDb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({ count: null, error: { message: 'Database connection failed' } }),
        })),
      })),
    }

    const result = await kedaService.getActiveOrders(mockDb)

    expect(result).toMatchObject({
      success: false,
      metric: 'active_orders',
      error: 'Database connection failed',
    })
    expectTimestamp(result)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'KEDA_ACTIVE_ORDERS_ERROR' }),
      expect.stringContaining('Failed to fetch active orders count'),
    )
  })

  it('generates active drivers metric from database count', async () => {
    const mockDb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 18, error: null }),
          })),
        })),
      })),
    }

    const result = await kedaService.getActiveDrivers(mockDb)

    expect(result).toMatchObject({
      success: true,
      metric: 'active_drivers',
      value: 18,
    })
    expectTimestamp(result)
    expect(mockDb.from).toHaveBeenCalledWith('profiles')
  })

  it('handles database errors gracefully when fetching active drivers', async () => {
    const mockDb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: null, error: { message: 'Profiles table unavailable' } }),
          })),
        })),
      })),
    }

    const result = await kedaService.getActiveDrivers(mockDb)

    expect(result).toMatchObject({
      success: false,
      metric: 'active_drivers',
      error: 'Profiles table unavailable',
    })
    expectTimestamp(result)
  })

  it('generates queue depth metric via Prometheus with query sanitization', async () => {
    axios.get.mockResolvedValue({
      data: {
        status: 'success',
        data: { result: [{ value: [1710000000, '128'] }] },
      },
    })

    const result = await kedaService.getQueueDepth('delivery-events')

    expect(result).toMatchObject({
      success: true,
      queue: 'delivery-events',
      depth: 128,
    })
    expect(axios.get).toHaveBeenCalledWith(
      'http://prometheus.istio-system:9090/api/v1/query',
      expect.objectContaining({
        params: {
          query: 'sum(truxify_queue_depth{queue="delivery-events"})',
        },
      }),
    )
  })

  it('handles queue depth query failure gracefully', async () => {
    axios.get.mockRejectedValue(new Error('Prometheus timeout'))

    const result = await kedaService.getQueueDepth('orders')

    expect(result).toMatchObject({
      success: false,
      queue: 'orders',
      error: 'Prometheus timeout',
    })
  })
})

describe('KEDAService.generateScaledObjectConfig', () => {
  it('generates a valid Kubernetes ScaledObject specification with defaults', () => {
    const config = kedaService.generateScaledObjectConfig({
      name: 'api-scaler',
      namespace: 'truxify',
      targetDeployment: 'api-deployment',
    })

    expect(config).toEqual({
      apiVersion: 'keda.sh/v1alpha1',
      kind: 'ScaledObject',
      metadata: {
        name: 'api-scaler',
        namespace: 'truxify',
        labels: {
          'app.kubernetes.io/name': 'api-scaler',
          'app.kubernetes.io/part-of': 'truxify',
        },
      },
      spec: {
        scaleTargetRef: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          name: 'api-deployment',
        },
        minReplicaCount: 1,
        maxReplicaCount: 10,
        pollingInterval: 30,
        cooldownPeriod: 300,
        triggers: [
          {
            type: 'prometheus',
            metadata: {
              serverAddress: 'http://prometheus.istio-system:9090',
              metricName: 'api_requests',
              query:
                'sum(rate(istio_requests_total{reporter="destination",destination_service=~"api-service.*"}[5m]))',
              threshold: '100',
            },
          },
        ],
      },
    })
  })

  it('generates custom ScaledObject specification with custom triggers and replicas', () => {
    const customTriggers = [
      {
        type: 'redis',
        metadata: {
          address: 'redis-service:6379',
          listName: 'order-queue',
          listLength: '50',
        },
      },
      {
        type: 'kafka',
        metadata: {
          bootstrapServers: 'kafka-1:9092',
          topic: 'orders',
          consumerGroup: 'order-processor',
          lagThreshold: '10',
        },
      },
    ]

    const config = kedaService.generateScaledObjectConfig({
      name: 'order-worker-scaler',
      namespace: 'production',
      targetDeployment: 'order-worker',
      minReplicas: 2,
      maxReplicas: 25,
      pollingInterval: 15,
      cooldownPeriod: 120,
      triggers: customTriggers,
    })

    expect(config.metadata.name).toBe('order-worker-scaler')
    expect(config.metadata.namespace).toBe('production')
    expect(config.spec.scaleTargetRef.name).toBe('order-worker')
    expect(config.spec.minReplicaCount).toBe(2)
    expect(config.spec.maxReplicaCount).toBe(25)
    expect(config.spec.pollingInterval).toBe(15)
    expect(config.spec.cooldownPeriod).toBe(120)
    expect(config.spec.triggers).toEqual(customTriggers)
  })

  it('validates required fields for ScaledObject generation', () => {
    expect(() => kedaService.generateScaledObjectConfig({ name: '' })).toThrow(
      'ScaledObject name is required',
    )
    expect(() =>
      kedaService.generateScaledObjectConfig({ name: 'test', namespace: '' }),
    ).toThrow('ScaledObject namespace is required')
    expect(() =>
      kedaService.generateScaledObjectConfig({
        name: 'test',
        namespace: 'ns',
        targetDeployment: '',
      }),
    ).toThrow('targetDeployment is required')
  })
})
