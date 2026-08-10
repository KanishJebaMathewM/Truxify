import axios from 'axios';
import logger from '../middleware/logger.js';

class KEDAService {
    constructor() {
        this.prometheusUrl = process.env.PROMETHEUS_URL || 'http://prometheus.istio-system:9090';
        this.kafkaBootstrap = process.env.KAFKA_BOOTSTRAP || 'kafka-1:9092,kafka-2:9092,kafka-3:9092';
        this.kafkaLagMetric = process.env.KAFKA_LAG_METRIC || 'kafka_consumergroup_lag';
        this.kafkaTopicLabel = process.env.KAFKA_TOPIC_LABEL || 'topic';
        this.kafkaConsumerGroupLabel = process.env.KAFKA_CONSUMER_GROUP_LABEL || 'consumergroup';

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
            logger.error('Metrics fetch failed:', error);
            return {
                success: false,
                error: error.message,
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
            logger.error('CPU usage fetch failed:', error);
            return {
                success: false,
                error: error.message,
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
            logger.error('Memory usage fetch failed:', error);
            return {
                success: false,
                error: error.message,
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
            logger.error('Replica count fetch failed:', error);
            return {
                success: false,
                error: error.message,
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
