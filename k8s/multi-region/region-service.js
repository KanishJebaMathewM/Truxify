import axios from 'axios';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';
import Redis from 'ioredis';

class RegionService {
    constructor() {
        this.regions = [];
        this.activeRegions = [];
        this.primaryRegion = null;
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        
        // Load region config
        this.loadRegionConfig();
        
        // Start health checks
        this.startHealthChecks();
        
        // Start data replication
        this.startDataReplication();
        
        logger.info('✅ Multi-Region Service initialized');
    }

    loadRegionConfig() {
        const config = process.env.REGIONS ? JSON.parse(process.env.REGIONS) : [
            {
                name: 'us-east-1',
                endpoint: process.env.US_EAST_ENDPOINT || 'https://us-east.truxify.com',
                cluster: 'us-east',
                primary: true,
                weight: 33
            },
            {
                name: 'eu-west-1',
                endpoint: process.env.EU_WEST_ENDPOINT || 'https://eu-west.truxify.com',
                cluster: 'eu-west',
                primary: false,
                weight: 33
            },
            {
                name: 'ap-south-1',
                endpoint: process.env.AP_SOUTH_ENDPOINT || 'https://ap-south.truxify.com',
                cluster: 'ap-south',
                primary: false,
                weight: 34
            }
        ];

        this.regions = config;
        this.activeRegions = config.filter(r => r.active !== false);
        this.primaryRegion = config.find(r => r.primary);
        
        logger.info(`✅ Loaded ${this.regions.length} regions`);
    }

    // ============ Health Checks ============

    async startHealthChecks() {
        setInterval(async () => {
            await this.checkAllRegions();
        }, 10000); // Every 10 seconds
    }

    async checkAllRegions() {
        const results = {};
        
        for (const region of this.regions) {
            results[region.name] = await this.checkRegionHealth(region);
        }
        
        // Update active regions
        const previousActive = this.activeRegions.map(r => r.name);
        this.activeRegions = this.regions.filter(r => results[r.name].healthy);
        
        // Check if failover needed
        if (previousActive.length !== this.activeRegions.length) {
            await this.handleFailover(previousActive, this.activeRegions);
        }
        
        // Cache health status
        await this.redis.setex(
            'regions:health',
            60,
            JSON.stringify(results)
        );
        
        return results;
    }

    async checkRegionHealth(region) {
        try {
            const start = Date.now();
            const response = await axios.get(`${region.endpoint}/health`, {
                timeout: 5000
            });
            const latency = Date.now() - start;
            
            return {
                healthy: response.status === 200,
                latency,
                status: response.status,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    // ============ Failover ============

    async handleFailover(previous, current) {
        logger.warn(`⚠️ Failover detected! Previous: ${previous.join(', ')} -> Current: ${current.join(', ')}`);
        
        // Find failed regions
        const failed = previous.filter(p => !current.includes(p));
        const recovered = current.filter(c => !previous.includes(c));
        
        // Update DNS (in production: Route53)
        if (failed.length > 0) {
            await this.updateDNS(failed, 'down');
        }
        if (recovered.length > 0) {
            await this.updateDNS(recovered, 'up');
        }
        
        // Store failover event
        await this.storeFailoverEvent({
            previous,
            current,
            failed,
            recovered,
            timestamp: new Date().toISOString()
        });
    }

    async updateDNS(regions, status) {
        // In production: Update Route53/Cloudflare
        logger.info(`🔧 Updating DNS for regions: ${regions.join(', ')} (${status})`);
    }

    // ============ Global Load Balancing ============

    getTargetRegion() {
        // Weighted round-robin
        const weights = this.activeRegions.map(r => r.weight || 0);
        const total = weights.reduce((a, b) => a + b, 0);
        let random = Math.random() * total;
        
        for (let i = 0; i < weights.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                return this.activeRegions[i];
            }
        }
        
        return this.activeRegions[0] || this.primaryRegion;
    }

    async routeRequest(request) {
        // Determine region based on request
        const region = this.getTargetRegion();
        
        if (!region) {
            throw new Error('No active regions available');
        }
        
        // Record routing decision
        await this.recordRouting(request, region);
        
        return region;
    }

    // ============ Data Replication ============

    async startDataReplication() {
        setInterval(async () => {
            await this.replicateData();
        }, 5000); // Every 5 seconds
    }

    async replicateData() {
        try {
            // Get data from primary region
            if (!this.primaryRegion) return;
            
            const data = await this.fetchDataFromRegion(this.primaryRegion);
            
            // Replicate to other regions
            for (const region of this.regions) {
                if (region.name === this.primaryRegion.name) continue;
                
                await this.replicateToRegion(region, data);
            }
            
            logger.info(`✅ Data replicated to ${this.regions.length - 1} regions`);
        } catch (error) {
            logger.error('Data replication failed:', error);
        }
    }

    async fetchDataFromRegion(region) {
        try {
            const response = await axios.get(`${region.endpoint}/api/replication/data`);
            return response.data;
        } catch (error) {
            logger.error(`Failed to fetch data from ${region.name}:`, error);
            return null;
        }
    }

    async replicateToRegion(region, data) {
        try {
            await axios.post(`${region.endpoint}/api/replication/receive`, data);
        } catch (error) {
            logger.error(`Failed to replicate to ${region.name}:`, error);
        }
    }

    // ============ Database Operations ============

    async storeFailoverEvent(event) {
        const { error } = await supabase
            .from('failover_events')
            .insert([{
                previous_regions: event.previous,
                current_regions: event.current,
                failed_regions: event.failed,
                recovered_regions: event.recovered,
                timestamp: event.timestamp
            }]);
        
        if (error) throw error;
    }

    async recordRouting(request, region) {
        await this.redis.incr(`routing:${region.name}:count`);
    }

    // ============ Metrics ============

    async getRegionMetrics() {
        const metrics = {};
        const routingStats = {};
        
        for (const region of this.regions) {
            const count = await this.redis.get(`routing:${region.name}:count`);
            routingStats[region.name] = parseInt(count) || 0;
        }
        
        const health = await this.redis.get('regions:health');
        
        return {
            regions: this.regions.map(r => ({
                ...r,
                routingCount: routingStats[r.name] || 0,
                status: health ? JSON.parse(health)[r.name] : null
            })),
            activeRegions: this.activeRegions.map(r => r.name),
            primaryRegion: this.primaryRegion?.name,
            timestamp: new Date().toISOString()
        };
    }

    async getReplicationLag() {
        const lag = {};
        for (const region of this.regions) {
            if (region.name === this.primaryRegion?.name) continue;
            
            const lastSync = await this.redis.get(`replication:${region.name}:last_sync`);
            if (lastSync) {
                lag[region.name] = Date.now() - parseInt(lastSync);
            }
        }
        return lag;
    }
}

export default new RegionService();