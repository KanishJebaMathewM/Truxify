import axios from 'axios';
import logger from '../../api/src/middleware/logger.js';

class KEDAService {
    constructor() {
        this.prometheusUrl = process.env.PROMETHEUS_URL || 'http://prometheus.istio-system:9090';
        this.kafkaBootstrap = process.env.KAFKA_BOOTSTRAP || 'kafka-1:9092,kafka-2:9092,kafka-3:9092';
        
        logger.info('✅ KEDA Service initialized');
    }

    async getMetrics(metricName, query) {
        try {
            const response = await axios.get(`${this.prometheusUrl}/api/v1/query`, {
                params: { query }
            });
            
            return {
                success: true,
                metric: metricName,
                value: response.data.data.result[0]?.value[1] || 0,
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
        try {
            // In production: query Kafka for lag
            const lag = Math.floor(Math.random() * 100);
            
            return {
                success: true,
                topic,
                consumerGroup,
                lag,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Kafka lag fetch failed:', error);
            return {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async getCPUUsage(namespace, deployment) {
        try {
            const query = `sum(rate(container_cpu_usage_seconds_total{namespace="${namespace}",pod=~"${deployment}-.*"}[5m]))`;
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
            const query = `sum(container_memory_usage_bytes{namespace="${namespace}",pod=~"${deployment}-.*"})`;
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
            const query = `kube_deployment_status_replicas{namespace="${namespace}",deployment="${deployment}"}`;
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
        const [requests, latency, cpu, memory, replicas] = await Promise.all([
            this.getAPIRequests(),
            this.getAPILatency(),
            this.getCPUUsage(namespace, deployment),
            this.getMemoryUsage(namespace, deployment),
            this.getReplicaCount(namespace, deployment)
        ]);
        
        return {
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
        
        let recommendedReplicas = metrics.replicas;
        
        // Scale based on requests
        if (metrics.requests > 50) {
            recommendedReplicas = Math.min(20, recommendedReplicas + 2);
        } else if (metrics.requests < 10) {
            recommendedReplicas = Math.max(2, recommendedReplicas - 1);
        }
        
        // Scale based on CPU
        if (metrics.cpu > 0.7) {
            recommendedReplicas = Math.min(20, recommendedReplicas + 1);
        }
        
        // Scale based on memory
        if (metrics.memory > 0.8) {
            recommendedReplicas = Math.min(20, recommendedReplicas + 1);
        }
        
        return {
            currentReplicas: metrics.replicas,
            recommendedReplicas,
            metrics,
            timestamp: new Date().toISOString()
        };
    }

    async getStats() {
        return {
            prometheusUrl: this.prometheusUrl,
            kafkaBootstrap: this.kafkaBootstrap,
            timestamp: new Date().toISOString()
        };
    }
}

export default new KEDAService();