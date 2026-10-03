import axios from 'axios';
import fs from 'fs';
import https from 'https';
import logger from '../middleware/logger.js';

class KEDAService {
    constructor() {
        this.prometheusUrl = process.env.PROMETHEUS_URL || 'http://prometheus.istio-system:9090';
        this.kafkaBootstrap = process.env.KAFKA_BOOTSTRAP || 'kafka-1:9092,kafka-2:9092,kafka-3:9092';
        this.kafkaLagMetric = process.env.KAFKA_LAG_METRIC || 'kafka_consumergroup_lag';
        this.kafkaTopicLabel = process.env.KAFKA_TOPIC_LABEL || 'topic';
        this.kafkaConsumerGroupLabel = process.env.KAFKA_CONSUMER_GROUP_LABEL || 'consumergroup';
        this.kedaApiUrl = process.env.KEDA_API_URL || 'https://kubernetes.default.svc';
        this.kedaApiToken = process.env.KEDA_API_TOKEN || '';
        this.kedaCaCertPath = process.env.KEDA_CA_CERT_PATH || '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
        this.kedaRequestTimeout = Number(process.env.KEDA_REQUEST_TIMEOUT_MS) || 5000;
        this.kedaPollInterval = Number(process.env.KEDA_POLL_INTERVAL_MS) || 1000;
        this.kedaPollTimeout = Number(process.env.KEDA_POLL_TIMEOUT_MS) || 10000;

        logger.info('KEDA Service initialized');
    }

    _sanitizePromqlInput(input) {
        return String(input || '').replace(/[^a-zA-Z0-9_.-]/g, '');
    }

    _sanitizePromqlRegex(input) {
        return String(input || '').replace(/[^a-zA-Z0-9_-]/g, '');
    }

    _sanitizePromqlIdentifier(input, fallback) {
        const sanitized = String(input || '').replace(/[^a-zA-Z0-9_:]/g, '');
        return sanitized || fallback;
    }

    /**
     * Build the authenticated HTTPS request options for the Kubernetes API.
     *
     * @returns {object} Axios request configuration
     * @throws {Error} when a bearer token would be sent over HTTP
     */
    _kedaRequestConfig() {
        const kedaUrl = new URL(this.kedaApiUrl);
        if (this.kedaApiToken && kedaUrl.protocol !== 'https:') {
            throw new Error('KEDA_API_URL must use HTTPS when KEDA_API_TOKEN is configured.');
        }

        const config = { timeout: this.kedaRequestTimeout };
        if (this.kedaApiToken) {
            config.headers = { Authorization: `Bearer ${this.kedaApiToken}` };
        }
        if (kedaUrl.protocol === 'https:' && fs.existsSync(this.kedaCaCertPath)) {
            config.httpsAgent = new https.Agent({
                ca: fs.readFileSync(this.kedaCaCertPath),
                rejectUnauthorized: true,
            });
        }
        return config;
    }

    /**
     * Fetch the status of one KEDA ScaledObject from the Kubernetes API.
     *
     * @param {string} namespace Kubernetes namespace containing the object
     * @param {string} scaledObjectName KEDA ScaledObject resource name
     * @returns {Promise<object>} normalized status or failure result
     */
    async getScaledObjectStatus(namespace, scaledObjectName) {
        const timestamp = () => new Date().toISOString();

        if (!namespace || !String(namespace).trim()) {
            return { success: false, error: 'namespace is required', timestamp: timestamp() };
        }

        if (!scaledObjectName || !String(scaledObjectName).trim()) {
            return { success: false, error: 'scaledObjectName is required', timestamp: timestamp() };
        }

        const url = `${this.kedaApiUrl}/apis/keda.sh/v1alpha1/namespaces/${encodeURIComponent(String(namespace).trim())}/scaledobjects/${encodeURIComponent(String(scaledObjectName).trim())}`;

        try {
            const response = await axios.get(url, this._kedaRequestConfig());

            if (response.status !== 200) {
                logger.error(
                    { event: 'KEDA_SCALED_OBJECT_STATUS_ERROR', statusCode: response.status },
                    'KEDA scaled object status request failed',
                );
                return {
                    success: false,
                    error: `KEDA API returned HTTP ${response.status}`,
                    statusCode: response.status,
                    timestamp: timestamp(),
                };
            }

            return {
                success: true,
                status: response.data?.status || {},
                data: response.data,
                timestamp: timestamp(),
            };
        } catch (error) {
            const errorMessage = error?.message ?? String(error);
            logger.warn(
                {
                    event: 'KEDA_SCALED_OBJECT_STATUS_ERROR',
                    error: errorMessage,
                    stack: error?.stack,
                },
                'KEDA scaled object status request failed',
            );
            return {
                success: false,
                error: errorMessage,
                ...(error?.response?.status ? { statusCode: error.response.status } : {}),
                timestamp: timestamp(),
            };
        }
    }

    /**
     * Poll a KEDA ScaledObject until a predicate succeeds or the timeout ends.
     *
     * @param {string} namespace Kubernetes namespace containing the object
     * @param {string} scaledObjectName KEDA ScaledObject resource name
     * @param {Function} predicate predicate evaluated against each returned status
     * @param {object} options polling interval and timeout in milliseconds
     * @returns {Promise<object>} successful status or timed-out failure result
     */
    async waitForScaledObjectStatus(namespace, scaledObjectName, predicate, options = {}) {
        const check = typeof predicate === 'function' ? predicate : () => true;
        const interval = Number(options.intervalMs) || this.kedaPollInterval;
        const timeout = Number(options.timeoutMs) || this.kedaPollTimeout;
        const startedAt = Date.now();
        let latestResult;

        do {
            latestResult = await this.getScaledObjectStatus(namespace, scaledObjectName);
            if (latestResult.success && check(latestResult.status, latestResult)) {
                return { ...latestResult, timedOut: false };
            }

            if (Date.now() - startedAt >= timeout) {
                break;
            }

            await new Promise(resolve => setTimeout(resolve, interval));
        } while (Date.now() - startedAt < timeout);

        logger.warn(
            { namespace, scaledObjectName, timeoutMs: timeout },
            'Timed out waiting for KEDA scaled object status',
        );

        return {
            ...(latestResult || {
                success: false,
                error: 'KEDA status polling did not run',
            }),
            success: false,
            timedOut: true,
            error: latestResult?.error || 'Timed out waiting for KEDA scaled object status',
        };
    }

    async getMetrics(metricName, query) {
        try {
            const response = await axios.get(`${this.prometheusUrl}/api/v1/query`, {
                params: { query },
                timeout: Number(process.env.PROMETHEUS_QUERY_TIMEOUT_MS) || 5000
            });

            if (response.data?.status !== 'success') {
                return {
                    success: false,
                    metric: metricName,
                    error: response.data?.error || 'Prometheus query failed',
                    timestamp: new Date().toISOString()
                };
            }

            return {
                success: true,
                metric: metricName,
                value: Number(response.data.data.result[0]?.value[1] || 0),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            const errorMessage = error?.message ?? String(error);
            logger.warn(
                { event: 'KEDA_METRICS_FETCH_ERROR', error: errorMessage, stack: error?.stack },
                'Metrics fetch failed',
            );
            return {
                success: false,
                error: errorMessage,
                timestamp: new Date().toISOString()
            };
        }
    }

    async getAPIRequests() {
        const query = 'sum(rate(istio_requests_total{reporter="destination",destination_service=~"api-service.*"}[5m]))';
        return await this.getMetrics('api_requests', query);
    }

    async getMLEngineRequests() {
        const query = 'sum(rate(istio_requests_total{reporter="destination",destination_service=~"ml-engine-service.*"}[5m]))';
        return await this.getMetrics('ml_requests', query);
    }

    async getAPILatency() {
        const query = 'histogram_quantile(0.95, sum(rate(istio_request_duration_milliseconds_bucket{reporter="destination",destination_service=~"api-service.*"}[5m])) by (le))';
        return await this.getMetrics('api_latency', query);
    }

    async getKafkaLag(topic, consumerGroup) {
        const safeTopic = this._sanitizePromqlInput(topic);
        const safeConsumerGroup = this._sanitizePromqlInput(consumerGroup);
        const metric = this._sanitizePromqlIdentifier(this.kafkaLagMetric, 'kafka_consumergroup_lag');
        const topicLabel = this._sanitizePromqlIdentifier(this.kafkaTopicLabel, 'topic');
        const groupLabel = this._sanitizePromqlIdentifier(this.kafkaConsumerGroupLabel, 'consumergroup');
        const query = `sum(${metric}{${topicLabel}="${safeTopic}",${groupLabel}="${safeConsumerGroup}"})`;
        const result = await this.getMetrics('kafka_lag', query);

        if (!result.success) {
            return {
                ...result,
                topic: safeTopic,
                consumerGroup: safeConsumerGroup
            };
        }

        return {
            success: true,
            topic: safeTopic,
            consumerGroup: safeConsumerGroup,
            lag: result.value,
            timestamp: result.timestamp
        };
    }

    async getCPUUsage(namespace, deployment) {
        try {
            const ns = this._sanitizePromqlInput(namespace);
            const dep = this._sanitizePromqlRegex(deployment);
            const query = `sum(rate(container_cpu_usage_seconds_total{namespace="${ns}",pod=~"${dep}-.*"}[5m]))`;
            return await this.getMetrics('cpu_usage', query);
        } catch (error) {
            const errorMessage = error?.message ?? String(error);
            logger.warn(
                { event: 'KEDA_CPU_FETCH_ERROR', error: errorMessage, stack: error?.stack },
                'CPU usage fetch failed',
            );
            return {
                success: false,
                error: errorMessage,
                timestamp: new Date().toISOString()
            };
        }
    }

    async getMemoryUsage(namespace, deployment) {
        try {
            const ns = this._sanitizePromqlInput(namespace);
            const dep = this._sanitizePromqlRegex(deployment);
            const query = `sum(container_memory_usage_bytes{namespace="${ns}",pod=~"${dep}-.*"})`;
            return await this.getMetrics('memory_usage', query);
        } catch (error) {
            const errorMessage = error?.message ?? String(error);
            logger.warn(
                { event: 'KEDA_MEMORY_FETCH_ERROR', error: errorMessage, stack: error?.stack },
                'Memory usage fetch failed',
            );
            return {
                success: false,
                error: errorMessage,
                timestamp: new Date().toISOString()
            };
        }
    }

    async getReplicaCount(namespace, deployment) {
        try {
            const ns = this._sanitizePromqlInput(namespace);
            const dep = this._sanitizePromqlInput(deployment);
            const query = `kube_deployment_status_replicas{namespace="${ns}",deployment="${dep}"}`;
            return await this.getMetrics('replica_count', query);
        } catch (error) {
            const errorMessage = error?.message ?? String(error);
            logger.warn(
                { event: 'KEDA_REPLICA_FETCH_ERROR', error: errorMessage, stack: error?.stack },
                'Replica count fetch failed',
            );
            return {
                success: false,
                error: errorMessage,
                timestamp: new Date().toISOString()
            };
        }
    }

    async getAutoscalingMetrics(namespace, deployment) {
        const results = await Promise.all([
            this.getAPIRequests(),
            this.getAPILatency(),
            this.getCPUUsage(namespace, deployment),
            this.getMemoryUsage(namespace, deployment),
            this.getReplicaCount(namespace, deployment)
        ]);
        const [requests, latency, cpu, memory, replicas] = results;
        const failures = results.filter(result => !result.success);

        if (failures.length > 0) {
            return {
                success: false,
                error: 'One or more autoscaling metrics are unavailable',
                details: failures,
                timestamp: new Date().toISOString()
            };
        }

        return {
            success: true,
            requests: requests.value || 0,
            latency: latency.value || 0,
            cpu: cpu.value || 0,
            memory: memory.value || 0,
            replicas: replicas.value || 0,
            timestamp: new Date().toISOString()
        };
    }

    async getScaleRecommendation(namespace, deployment) {
        const metrics = await this.getAutoscalingMetrics(namespace, deployment);

        if (!metrics.success) {
            return metrics;
        }

        let recommendedReplicas = metrics.replicas;

        if (metrics.requests > 50) {
            recommendedReplicas = Math.min(20, recommendedReplicas + 2);
        } else if (metrics.requests < 10) {
            recommendedReplicas = Math.max(2, recommendedReplicas - 1);
        }

        if (metrics.cpu > 0.7) {
            recommendedReplicas = Math.min(20, recommendedReplicas + 1);
        }

        if (metrics.memory > 0.8) {
            recommendedReplicas = Math.min(20, recommendedReplicas + 1);
        }

        return {
            success: true,
            currentReplicas: metrics.replicas,
            recommendedReplicas,
            metrics,
            timestamp: new Date().toISOString()
        };
    }

    
    async getServiceHealthDiagnostics(namespace = 'default', deployment = 'api-service') {
        try {
            const autoscaling = await this.getAutoscalingMetrics(namespace, deployment);
            return {
                status: autoscaling.success ? 'HEALTHY' : 'DEGRADED',
                diagnosticsTimestamp: new Date().toISOString(),
                metricsStatus: autoscaling
            };
        } catch (error) {
            const errorMessage = error?.message ?? String(error);
            logger.warn(
                { event: 'KEDA_DIAGNOSTICS_ERROR', error: errorMessage, stack: error?.stack },
                'Health diagnostics failed',
            );
            return {
                status: 'UNHEALTHY',
                error: errorMessage,
                diagnosticsTimestamp: new Date().toISOString()
            };
        }
    }

    async getStats() {
        return {
            kafkaLagMetric: this.kafkaLagMetric,
            prometheusConfigured: Boolean(this.prometheusUrl),
            kafkaBootstrapConfigured: Boolean(this.kafkaBootstrap),
            timestamp: new Date().toISOString()
        };
    }
}

export default new KEDAService();
