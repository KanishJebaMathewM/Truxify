import consul from 'consul';
import axios from 'axios';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';

class ConsulService {
    constructor() {
        this.consul = consul({
            host: process.env.CONSUL_HOST || 'consul-server',
            port: process.env.CONSUL_PORT || 8500,
            promisify: true
        });

        this.services = {};
        this.serviceCache = new Map();
        this.healthChecks = {};
        this._healthInterval = null;

        // Start health checks
        this.startHealthChecks();

        logger.info('✅ Consul Service initialized');
    }

    // ============ Service Registration ============

    async registerService(serviceConfig) {
        try {
            const { id, name, address, port, tags, meta, check } = serviceConfig;

            // Register service with Consul
            await this.consul.agent.service.register({
                id,
                name,
                address,
                port,
                tags: tags || [],
                meta: meta || {},
                check: check || {
                    http: `http://${address}:${port}/health`,
                    interval: '10s',
                    timeout: '5s',
                    deregisterCriticalServiceAfter: '30s'
                }
            });

            // Store service info
            this.services[id] = {
                id,
                name,
                address,
                port,
                tags: tags || [],
                meta: meta || {},
                registeredAt: new Date().toISOString()
            };

            logger.info(`✅ Service registered: ${id}`);
            return {
                success: true,
                serviceId: id,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Service registration failed:', error);
            throw error;
        }
    }

    async deregisterService(serviceId) {
        try {
            await this.consul.agent.service.deregister(serviceId);
            delete this.services[serviceId];
            this.serviceCache.delete(serviceId);

            logger.info(`✅ Service deregistered: ${serviceId}`);
            return {
                success: true,
                serviceId,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Service deregistration failed:', error);
            throw error;
        }
    }

    // ============ Service Discovery ============

    async discoverService(serviceName, healthyOnly = true) {
        try {
            // Check cache
            const cacheKey = `${serviceName}_${healthyOnly}`;
            if (this.serviceCache.has(cacheKey)) {
                const cached = this.serviceCache.get(cacheKey);
                if (Date.now() - cached.timestamp < 30000) { // 30 seconds cache
                    return cached.data;
                }
            }

            // Query Consul
            const services = await this.consul.catalog.service.nodes(serviceName);

            // Filter healthy services
            let healthyServices = services;
            if (healthyOnly) {
                const health = await this.consul.health.service(serviceName);
                healthyServices = health
                    .filter(h => h.Checks.every(c => c.Status === 'passing'))
                    .map(h => ({
                        id: h.Service.ID,
                        address: h.Service.Address,
                        port: h.Service.Port,
                        tags: h.Service.Tags,
                        meta: h.Service.Meta
                    }));
            }

            // Update cache
            this.serviceCache.set(cacheKey, {
                data: healthyServices,
                timestamp: Date.now()
            });

            return healthyServices;
        } catch (error) {
            logger.error('Service discovery failed:', error);
            return [];
        }
    }

    async getServiceAddress(serviceName, healthyOnly = true) {
        const services = await this.discoverService(serviceName, healthyOnly);
        if (services.length === 0) {
            return null;
        }

        // Round-robin load balancing
        const service = services[Math.floor(Math.random() * services.length)];
        return `${service.address}:${service.port}`;
    }

    // ============ Health Checks ============

    startHealthChecks() {
        this._healthInterval = setInterval(async () => {
            await this.checkAllServices();
        }, 30000); // Every 30 seconds
    }

    stopHealthChecks() {
        if (this._healthInterval) {
            clearInterval(this._healthInterval);
            this._healthInterval = null;
        }
    }

    async checkAllServices() {
        const results = {};

        try {
            const catalogServices = await this.consul.catalog.services();
            const serviceNames = Object.keys(catalogServices);

            for (const name of serviceNames) {
                const services = await this.discoverService(name, false);
                for (const service of services) {
                    try {
                        const health = await this.consul.health.checks(service.id);
                        const isHealthy = health.length > 0 && health.some(c => c.Status === 'passing');

                        results[service.id] = {
                            healthy: isHealthy,
                            lastCheck: new Date().toISOString(),
                            status: isHealthy ? 'passing' : 'critical'
                        };
                    } catch (error) {
                        results[service.id] = {
                            healthy: false,
                            lastCheck: new Date().toISOString(),
                            error: error.message
                        };
                    }
                }
            }
        } catch (error) {
            logger.error('checkAllServices failed:', error);
        }

        this.healthChecks = results;
        return results;
    }

    async getServiceHealth(serviceId) {
        try {
            const health = await this.consul.health.checks(serviceId);
            const isHealthy = health.length > 0 && health.some(c => c.Status === 'passing');
            return {
                id: serviceId,
                healthy: isHealthy,
                status: isHealthy ? 'passing' : 'critical',
                lastCheck: new Date().toISOString()
            };
        } catch (error) {
            return {
                id: serviceId,
                healthy: false,
                error: error.message,
                lastCheck: new Date().toISOString()
            };
        }
    }

    // ============ KV Store ============

    async setKV(key, value) {
        try {
            await this.consul.kv.set(key, value);
            return {
                success: true,
                key,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('KV set failed:', error);
            throw error;
        }
    }

    async getKV(key) {
        try {
            const result = await this.consul.kv.get(key);
            return result ? {
                key,
                value: result.Value,
                timestamp: new Date().toISOString()
            } : null;
        } catch (error) {
            logger.error('KV get failed:', error);
            return null;
        }
    }

    async deleteKV(key) {
        try {
            await this.consul.kv.delete(key);
            return {
                success: true,
                key,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('KV delete failed:', error);
            throw error;
        }
    }

    // ============ Multi-Cloud ============

    async registerMultiCloudService(cloud, serviceConfig) {
        const cloudConfig = {
            aws: {
                address: process.env.AWS_SERVICE_ADDRESS || 'api.aws.truxify.com',
                meta: { cloud: 'aws', region: 'us-east-1' }
            },
            azure: {
                address: process.env.AZURE_SERVICE_ADDRESS || 'api.azure.truxify.com',
                meta: { cloud: 'azure', region: 'east-us' }
            },
            gcp: {
                address: process.env.GCP_SERVICE_ADDRESS || 'api.gcp.truxify.com',
                meta: { cloud: 'gcp', region: 'us-central1' }
            }
        };

        const config = cloudConfig[cloud];
        if (!config) {
            throw new Error(`Unknown cloud: ${cloud}`);
        }

        return await this.registerService({
            ...serviceConfig,
            address: config.address,
            meta: {
                ...serviceConfig.meta,
                ...config.meta,
                cloud: cloud
            }
        });
    }

    // ============ Stats ============

    async getConsulStats() {
        try {
            const members = await this.consul.agent.members();
            const services = await this.consul.agent.services();

            return {
                members: members.length,
                services: Object.keys(services).length,
                healthyServices: Object.values(this.healthChecks).filter(h => h.healthy).length,
                serviceCache: this.serviceCache.size,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Stats fetch failed:', error);
            return null;
        }
    }
}

export default new ConsulService();