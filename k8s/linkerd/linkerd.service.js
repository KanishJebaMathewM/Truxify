import axios from 'axios';
import logger from '../../api/src/middleware/logger.js';

class LinkerdService {
    constructor() {
        this.prometheusUrl = process.env.PROMETHEUS_URL || 'http://prometheus.linkerd:9090';
        this.linkerdDashboard = process.env.LINKERD_DASHBOARD || 'http://localhost:50750';
        
        logger.info('✅ Linkerd Service initialized');
    }

    async getMetrics(query) {
        try {
            const response = await axios.get(`${this.prometheusUrl}/api/v1/query`, {
                params: { query }
            });
            return response.data.data.result;
        } catch (error) {
            logger.error('Metrics fetch failed:', error);
            return [];
        }
    }

    async getSuccessRate(namespace = 'truxify', deployment = 'api-deployment') {
        const query = `
            sum(rate(response_total{
                namespace="${namespace}",
                deployment="${deployment}",
                classification="success"
            }[5m])) / 
            sum(rate(response_total{
                namespace="${namespace}",
                deployment="${deployment}"
            }[5m]))
        `;
        const result = await this.getMetrics(query);
        return result[0]?.value[1] || 0;
    }

    async getLatency(namespace = 'truxify', deployment = 'api-deployment') {
        const query = `
            histogram_quantile(0.95, 
                sum(rate(response_latency_ms_bucket{
                    namespace="${namespace}",
                    deployment="${deployment}"
                }[5m])) by (le)
            )
        `;
        const result = await this.getMetrics(query);
        return result[0]?.value[1] || 0;
    }

    async getRequestRate(namespace = 'truxify', deployment = 'api-deployment') {
        const query = `
            sum(rate(response_total{
                namespace="${namespace}",
                deployment="${deployment}"
            }[5m]))
        `;
        const result = await this.getMetrics(query);
        return result[0]?.value[1] || 0;
    }

    async getMeshedPods(namespace = 'truxify') {
        const query = `
            count(proxy_requests_total{
                namespace="${namespace}"
            })
        `;
        const result = await this.getMetrics(query);
        return result[0]?.value[1] || 0;
    }

    async getServiceMetrics(service = 'api-service', namespace = 'truxify') {
        const metrics = {
            successRate: await this.getSuccessRate(namespace, service),
            latency: await this.getLatency(namespace, service),
            requestRate: await this.getRequestRate(namespace, service),
            meshedPods: await this.getMeshedPods(namespace)
        };
        
        return metrics;
    }

    async getEndpointMetrics() {
        const endpoints = ['api-service', 'ml-engine-service', 'redis-service'];
        const metrics = {};
        
        for (const endpoint of endpoints) {
            metrics[endpoint] = await this.getServiceMetrics(endpoint);
        }
        
        return metrics;
    }

    async getTopRoutes(namespace = 'truxify', limit = 10) {
        const query = `
            topk(${limit}, 
                sum(rate(response_total{
                    namespace="${namespace}"
                }[5m])) by (dst_service, dst_deployment)
            )
        `;
        const result = await this.getMetrics(query);
        return result.map(r => ({
            service: r.metric.dst_service,
            deployment: r.metric.dst_deployment,
            requests: r.value[1]
        }));
    }

    async getErrorRate(namespace = 'truxify', deployment = 'api-deployment') {
        const query = `
            sum(rate(response_total{
                namespace="${namespace}",
                deployment="${deployment}",
                classification="failure"
            }[5m])) / 
            sum(rate(response_total{
                namespace="${namespace}",
                deployment="${deployment}"
            }[5m]))
        `;
        const result = await this.getMetrics(query);
        return result[0]?.value[1] || 0;
    }

    async getMeshedStatus(namespace = 'truxify') {
        const query = `
            count(proxy_requests_total{
                namespace="${namespace}"
            }) by (pod)
        `;
        const result = await this.getMetrics(query);
        return {
            totalPods: result.length,
            meshedPods: result.length
        };
    }

    async getStats() {
        const endpointMetrics = await this.getEndpointMetrics();
        const topRoutes = await this.getTopRoutes();
        const meshedStatus = await this.getMeshedStatus();
        
        return {
            endpointMetrics,
            topRoutes,
            meshedStatus,
            timestamp: new Date().toISOString()
        };
    }

    async checkHealth() {
        try {
            await axios.get(`${this.linkerdDashboard}/metrics`);
            return { status: 'healthy', linkerd: true };
        } catch (error) {
            return { status: 'unhealthy', linkerd: false, error: error.message };
        }
    }
}

export default new LinkerdService();