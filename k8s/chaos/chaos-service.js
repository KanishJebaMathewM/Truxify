import axios from 'axios';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';

class ChaosService {
    constructor() {
        this.gremlinApiUrl = process.env.GREMLIN_API_URL || 'https://api.gremlin.com/v1';
        this.gremlinApiKey = process.env.GREMLIN_API_KEY;
        this.teamId = process.env.GREMLIN_TEAM_ID;
        this.resilienceScore = 100;
        this.experimentHistory = [];
        this.healthChecks = {};
        
        logger.info('✅ Chaos Engineering Service initialized');
    }

    // ============ Experiment Management ============

    async runExperiment(experimentType, config = {}) {
        try {
            const experiment = {
                type: experimentType,
                config,
                status: 'running',
                startTime: new Date().toISOString(),
                id: `exp_${Date.now()}`
            };

            // Run experiment based on type
            switch (experimentType) {
                case 'pod-kill':
                    await this.runPodKill(config);
                    break;
                case 'network-latency':
                    await this.runNetworkLatency(config);
                    break;
                case 'cpu-stress':
                    await this.runCpuStress(config);
                    break;
                case 'memory-stress':
                    await this.runMemoryStress(config);
                    break;
                case 'service-disruption':
                    await this.runServiceDisruption(config);
                    break;
                default:
                    throw new Error(`Unknown experiment type: ${experimentType}`);
            }

            experiment.status = 'completed';
            experiment.endTime = new Date().toISOString();

            // Store experiment
            await this.storeExperiment(experiment);
            this.experimentHistory.push(experiment);

            // Update resilience score
            await this.updateResilienceScore(experiment);

            logger.info(`✅ Experiment ${experimentType} completed`);
            return experiment;

        } catch (error) {
            logger.error(`Experiment ${experimentType} failed:`, error);
            throw error;
        }
    }

    async runPodKill(config) {
        // Kill pods
        const { namespace = 'truxify', labelSelector = 'app=api', count = 1 } = config;
        
        const response = await axios.post(
            `${this.gremlinApiUrl}/experiments`,
            {
                name: 'pod-kill',
                target: {
                    type: 'Kubernetes',
                    selector: {
                        namespace: namespace,
                        labelSelector: labelSelector
                    }
                },
                parameters: {
                    count: count
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.gremlinApiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data;
    }

    async runNetworkLatency(config) {
        const { namespace = 'truxify', labelSelector = 'app=api', latency = '300ms', duration = '5m' } = config;
        
        const response = await axios.post(
            `${this.gremlinApiUrl}/experiments`,
            {
                name: 'network-latency',
                target: {
                    type: 'Kubernetes',
                    selector: {
                        namespace: namespace,
                        labelSelector: labelSelector
                    }
                },
                parameters: {
                    latency: latency,
                    duration: duration
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.gremlinApiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data;
    }

    async runCpuStress(config) {
        const { namespace = 'truxify', labelSelector = 'app=ml-engine', workers = 2, load = 80, duration = '10m' } = config;
        
        const response = await axios.post(
            `${this.gremlinApiUrl}/experiments`,
            {
                name: 'cpu-stress',
                target: {
                    type: 'Kubernetes',
                    selector: {
                        namespace: namespace,
                        labelSelector: labelSelector
                    }
                },
                parameters: {
                    workers: workers,
                    load: load,
                    duration: duration
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.gremlinApiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data;
    }

    async runMemoryStress(config) {
        const { namespace = 'truxify', labelSelector = 'app=redis', memory = '512MB', duration = '5m' } = config;
        
        const response = await axios.post(
            `${this.gremlinApiUrl}/experiments`,
            {
                name: 'memory-stress',
                target: {
                    type: 'Kubernetes',
                    selector: {
                        namespace: namespace,
                        labelSelector: labelSelector
                    }
                },
                parameters: {
                    memory: memory,
                    duration: duration
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.gremlinApiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data;
    }

    async runServiceDisruption(config) {
        const { service = 'api-service', namespace = 'truxify', duration = '2m' } = config;
        
        const response = await axios.post(
            `${this.gremlinApiUrl}/experiments`,
            {
                name: 'service-disruption',
                target: {
                    type: 'Kubernetes',
                    selector: {
                        namespace: namespace,
                        service: service
                    }
                },
                parameters: {
                    duration: duration
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.gremlinApiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data;
    }

    // ============ Resilience Scoring ============

    async updateResilienceScore(experiment) {
        // Calculate impact
        const impact = this.calculateImpact(experiment);
        
        // Update score
        this.resilienceScore = Math.max(0, this.resilienceScore - impact);
        this.resilienceScore = Math.min(100, this.resilienceScore);

        // Store score
        await supabase
            .from('resilience_scores')
            .insert([{
                score: this.resilienceScore,
                experiment_id: experiment.id,
                experiment_type: experiment.type,
                timestamp: new Date().toISOString()
            }]);

        return this.resilienceScore;
    }

    calculateImpact(experiment) {
        let impact = 0;
        
        switch (experiment.type) {
            case 'pod-kill':
                impact = 5;
                break;
            case 'network-latency':
                impact = 3;
                break;
            case 'cpu-stress':
                impact = 2;
                break;
            case 'memory-stress':
                impact = 2;
                break;
            case 'service-disruption':
                impact = 10;
                break;
            default:
                impact = 5;
        }

        return impact;
    }

    async getResilienceScore() {
        return this.resilienceScore;
    }

    async getResilienceHistory(limit = 100) {
        const { data, error } = await supabase
            .from('resilience_scores')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(limit);

        if (error) {
            logger.error('Failed to get resilience history:', error);
            return [];
        }

        return data;
    }

    // ============ Health Checks ============

    async checkSystemHealth() {
        const health = {
            api: await this.checkServiceHealth('api-service', 5000),
            ml: await this.checkServiceHealth('ml-engine-service', 8000),
            redis: await this.checkServiceHealth('redis-service', 6379),
            db: await this.checkServiceHealth('db-service', 5432),
            timestamp: new Date().toISOString()
        };

        this.healthChecks = health;
        return health;
    }

    async checkServiceHealth(service, port) {
        try {
            const response = await axios.get(`http://${service}.truxify.svc.cluster.local:${port}/health`, {
                timeout: 5000
            });
            return {
                status: 'healthy',
                responseTime: response.data?.responseTime || 0,
                statusCode: response.status
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                statusCode: error.response?.status || 500
            };
        }
    }

    // ============ Chaos Automation ============

    async scheduleExperiments() {
        // Schedule chaos experiments based on schedule
        const experiments = [
            { type: 'pod-kill', config: { count: 1 }, schedule: '0 */6 * * *' },
            { type: 'network-latency', config: { latency: '200ms' }, schedule: '0 */12 * * *' },
            { type: 'cpu-stress', config: { load: 70 }, schedule: '0 */8 * * *' }
        ];

        for (const exp of experiments) {
            await this.runExperiment(exp.type, exp.config);
        }
    }

    // ============ Statistics ============

    async getChaosStats() {
        const experiments = await this.getExperimentHistory(100);
        const resilience = await this.getResilienceHistory(100);

        return {
            totalExperiments: experiments.length,
            successRate: this.calculateSuccessRate(experiments),
            averageResilience: this.calculateAverageResilience(resilience),
            lastExperiment: experiments[0] || null,
            currentResilience: this.resilienceScore,
            timestamp: new Date().toISOString()
        };
    }

    calculateSuccessRate(experiments) {
        if (experiments.length === 0) return 100;
        const successful = experiments.filter(e => e.status === 'completed').length;
        return (successful / experiments.length) * 100;
    }

    calculateAverageResilience(resilience) {
        if (resilience.length === 0) return 100;
        const sum = resilience.reduce((acc, r) => acc + r.score, 0);
        return sum / resilience.length;
    }

    async storeExperiment(experiment) {
        const { error } = await supabase
            .from('chaos_experiments')
            .insert([{
                id: experiment.id,
                type: experiment.type,
                status: experiment.status,
                config: experiment.config,
                start_time: experiment.startTime,
                end_time: experiment.endTime,
                created_at: new Date().toISOString()
            }]);

        if (error) throw error;
    }

    async getExperimentHistory(limit = 100) {
        const { data, error } = await supabase
            .from('chaos_experiments')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            logger.error('Failed to get experiment history:', error);
            return [];
        }

        return data;
    }
}

export default new ChaosService();