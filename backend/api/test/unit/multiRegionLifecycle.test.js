import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const redisQuit = vi.fn().mockResolvedValue('OK');

vi.mock('ioredis', () => ({
    default: class RedisMock {
        quit = redisQuit;
    }
}));

vi.mock('../../src/middleware/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

vi.mock('../../src/config/db.js', () => ({
    
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabase: {}
}));

vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn()
    }
}));

describe('RegionService lifecycle', () => {
    let RegionService;
    let singleton;

    beforeEach(async () => {
        vi.useFakeTimers();
        redisQuit.mockClear();
        axios.get.mockReset();
        axios.post.mockReset();

        const module = await import('../../../../k8s/multi-region/region-service.js');
        RegionService = module.RegionService;
        singleton = module.default;
    });

    afterEach(async () => {
        if (singleton && !singleton._stopped) {
            await singleton.stop();
        }
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('does not create duplicate health or replication intervals', async () => {
        const service = Object.create(RegionService.prototype);
        service._healthInterval = null;
        service._replicationInterval = null;
        service._stopped = false;
        service.checkAllRegions = vi.fn();
        service.replicateData = vi.fn();

        await service.startHealthChecks();
        const healthHandle = service._healthInterval;
        await service.startHealthChecks();

        await service.startDataReplication();
        const replicationHandle = service._replicationInterval;
        await service.startDataReplication();

        expect(service._healthInterval).toBe(healthHandle);
        expect(service._replicationInterval).toBe(replicationHandle);

        clearInterval(service._healthInterval);
        clearInterval(service._replicationInterval);
    });

    it('does not overlap health-check runs when one exceeds the interval', async () => {
        const service = Object.create(RegionService.prototype);
        service._healthInterval = null;
        service._healthCheckInProgress = false;
        service._stopped = false;

        let resolveHealthCheck;
        service.checkAllRegions = vi.fn().mockImplementation(
            () => new Promise(resolve => {
                resolveHealthCheck = resolve;
            })
        );

        await service.startHealthChecks();

        await vi.advanceTimersByTimeAsync(10000);
        expect(service.checkAllRegions).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(10000);
        expect(service.checkAllRegions).toHaveBeenCalledTimes(1);

        resolveHealthCheck();
        await vi.advanceTimersByTimeAsync(0);

        await vi.advanceTimersByTimeAsync(10000);
        expect(service.checkAllRegions).toHaveBeenCalledTimes(2);

        clearInterval(service._healthInterval);
    });

    it('releases the health-check guard when a run fails', async () => {
        const service = Object.create(RegionService.prototype);
        service._healthInterval = null;
        service._healthCheckInProgress = false;
        service._stopped = false;
        service.checkAllRegions = vi.fn()
            .mockRejectedValueOnce(new Error('health check failed'))
            .mockResolvedValueOnce({});

        await service.startHealthChecks();

        await vi.advanceTimersByTimeAsync(10000);
        expect(service.checkAllRegions).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(0);
        expect(service._healthCheckInProgress).toBe(false);

        await vi.advanceTimersByTimeAsync(10000);
        expect(service.checkAllRegions).toHaveBeenCalledTimes(2);

        clearInterval(service._healthInterval);
    });

    it('clears both interval handles and closes Redis on stop', async () => {
        const service = Object.create(RegionService.prototype);
        service._healthInterval = setInterval(() => {}, 10000);
        service._replicationInterval = setInterval(() => {}, 5000);
        service._stopped = false;
        service.redis = { quit: vi.fn().mockResolvedValue('OK') };

        await service.stop();

        expect(service._healthInterval).toBeNull();
        expect(service._replicationInterval).toBeNull();
        expect(service.redis.quit).toHaveBeenCalledOnce();
        expect(service._stopped).toBe(true);
    });

    it('treats stop as terminal and does not restart intervals', async () => {
        const service = Object.create(RegionService.prototype);
        service._healthInterval = null;
        service._replicationInterval = null;
        service._stopped = false;
        service.redis = { quit: vi.fn().mockResolvedValue('OK') };
        service.checkAllRegions = vi.fn();
        service.replicateData = vi.fn();

        await service.startHealthChecks();
        await service.startDataReplication();
        await service.stop();
        await service.startHealthChecks();
        await service.startDataReplication();

        expect(service._healthInterval).toBeNull();
        expect(service._replicationInterval).toBeNull();
    });

    it('promotes a healthy region when the replication primary fails', async () => {
        const primary = { name: 'primary', primary: true };
        const secondary = { name: 'secondary', primary: false };
        const tertiary = { name: 'tertiary', primary: false };

        const service = Object.create(RegionService.prototype);
        service.primaryRegion = primary;
        service.regions = [primary, secondary, tertiary];
        service.updateDNS = vi.fn().mockResolvedValue(undefined);
        service.storeFailoverEvent = vi.fn().mockResolvedValue(undefined);

        await service.handleFailover(
            ['primary', 'secondary', 'tertiary'],
            [secondary, tertiary]
        );

        expect(service.primaryRegion).toBe(secondary);
        expect(primary.primary).toBe(false);
        expect(secondary.primary).toBe(true);
        expect(tertiary.primary).toBe(false);
        expect(service.updateDNS).toHaveBeenCalledOnce();
        expect(service.updateDNS).toHaveBeenCalledWith(['primary'], 'down');
    });

    it('uses the promoted region as the replication source', async () => {
        const primary = { name: 'primary', primary: true };
        const secondary = { name: 'secondary', primary: false };
        const service = Object.create(RegionService.prototype);
        service._stopped = false;
        service.primaryRegion = primary;
        service.regions = [primary, secondary];
        service.updateDNS = vi.fn().mockResolvedValue(undefined);
        service.storeFailoverEvent = vi.fn().mockResolvedValue(undefined);
        service.fetchDataFromRegion = vi.fn().mockResolvedValue({ payload: true });
        service.replicateToRegion = vi.fn().mockResolvedValue(undefined);
        service.redis = {
            incr: vi.fn(),
            set: vi.fn()
        };

        await service.handleFailover(['primary', 'secondary'], [secondary]);
        await service.replicateData();

        expect(service.fetchDataFromRegion).toHaveBeenCalledOnce();
        expect(service.fetchDataFromRegion).toHaveBeenCalledWith(secondary);
        expect(service.replicateToRegion).toHaveBeenCalledWith(primary, { payload: true });
    });

    it('does not replace the primary when the current primary remains healthy', async () => {
        const primary = { name: 'primary', primary: true };
        const secondary = { name: 'secondary', primary: false };
        const service = Object.create(RegionService.prototype);
        service.primaryRegion = primary;
        service.regions = [primary, secondary];
        service.updateDNS = vi.fn().mockResolvedValue(undefined);
        service.storeFailoverEvent = vi.fn().mockResolvedValue(undefined);

        await service.handleFailover(['primary'], [primary, secondary]);

        expect(service.primaryRegion).toBe(primary);
        expect(primary.primary).toBe(true);
        expect(secondary.primary).toBe(false);
    });

    it('does not propagate a null payload after the primary fetch fails', async () => {
        const primary = { name: 'primary' };
        const secondary = { name: 'secondary' };
        const service = Object.create(RegionService.prototype);
        service._stopped = false;
        service.primaryRegion = primary;
        service.regions = [primary, secondary];
        service.fetchDataFromRegion = vi.fn().mockResolvedValue(null);
        service.replicateToRegion = vi.fn();
        service.redis = {
            incr: vi.fn(),
            set: vi.fn()
        };

        await service.replicateData();

        expect(service.fetchDataFromRegion).toHaveBeenCalledOnce();
        expect(service.fetchDataFromRegion).toHaveBeenCalledWith(primary);
        expect(service.replicateToRegion).not.toHaveBeenCalled();
        expect(service.redis.incr).not.toHaveBeenCalled();
        expect(service.redis.set).not.toHaveBeenCalled();
    });

    it('does not perform Redis work from a callback that resumes after stop', async () => {
        let resolveFetch;
        const fetchPromise = new Promise(resolve => {
            resolveFetch = resolve;
        });

        const service = Object.create(RegionService.prototype);
        service._healthInterval = null;
        service._replicationInterval = null;
        service._stopped = false;
        service.primaryRegion = { name: 'primary' };
        service.regions = [{ name: 'primary' }, { name: 'secondary' }];
        service.fetchDataFromRegion = vi.fn().mockReturnValue(fetchPromise);
        service.replicateToRegion = vi.fn();
        service.redis = {
            quit: vi.fn().mockResolvedValue('OK'),
            incr: vi.fn(),
            set: vi.fn()
        };

        const replication = service.replicateData();
        await service.stop();
        resolveFetch({ payload: true });
        await replication;

        expect(service.replicateToRegion).not.toHaveBeenCalled();
        expect(service.redis.incr).not.toHaveBeenCalled();
        expect(service.redis.set).not.toHaveBeenCalled();
    });

    it('returns empty health metrics when the Redis health payload is malformed', async () => {
        const service = Object.create(RegionService.prototype);
        service.regions = [{ name: 'us-east-1' }];
        service.redis = {
            get: vi.fn()
                .mockResolvedValueOnce('12')
                .mockResolvedValueOnce('{invalid-json')
        };

        const metrics = await service.getRegionMetrics();

        expect(metrics).toEqual({
            routing: { 'us-east-1': 12 },
            health: {}
        });
    });

    it('preserves valid Redis health metrics', async () => {
        const health = {
            'us-east-1': {
                healthy: true,
                latency: 42
            }
        };
        const service = Object.create(RegionService.prototype);
        service.regions = [{ name: 'us-east-1' }];
        service.redis = {
            get: vi.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(JSON.stringify(health))
        };

        const metrics = await service.getRegionMetrics();

        expect(metrics.routing).toEqual({ 'us-east-1': 0 });
        expect(metrics.health).toEqual(health);
    });

    it('returns empty health metrics for valid non-object Redis payloads', async () => {
        const service = Object.create(RegionService.prototype);
        service.regions = [{ name: 'us-east-1' }];
        service.redis = {
            get: vi.fn()
                .mockResolvedValueOnce('not-a-number')
                .mockResolvedValueOnce('null')
        };

        const metrics = await service.getRegionMetrics();

        expect(metrics).toEqual({
            routing: { 'us-east-1': 0 },
            health: {}
        });
    });

    it('rethrows the original error and records a failed replication', async () => {
        const replicationError = new Error('secondary unavailable');
        axios.post.mockRejectedValueOnce(replicationError);

        const service = Object.create(RegionService.prototype);
        service._stopped = false;
        service.redis = {
            set: vi.fn(),
            incr: vi.fn()
        };

        const region = { name: 'secondary', endpoint: 'https://secondary.example' };

        await expect(service.replicateToRegion(region, { payload: true })).rejects.toBe(replicationError);
        expect(service.redis.incr).toHaveBeenCalledWith('replication:secondary:error_count');
        expect(service.redis.set).toHaveBeenCalledWith(
            'replication:secondary:last_error',
            expect.any(String)
        );
        expect(service.redis.set).not.toHaveBeenCalledWith(
            'replication:secondary:last_sync',
            expect.anything()
        );
    });

    it('records successful replication without incrementing the error counter', async () => {
        axios.post.mockResolvedValueOnce({ status: 200 });

        const service = Object.create(RegionService.prototype);
        service._stopped = false;
        service.redis = {
            set: vi.fn(),
            incr: vi.fn()
        };

        const region = { name: 'secondary', endpoint: 'https://secondary.example' };

        await service.replicateToRegion(region, { payload: true });

        expect(service.redis.set).toHaveBeenCalledWith(
            'replication:secondary:last_sync',
            expect.any(Number)
        );
        expect(service.redis.incr).not.toHaveBeenCalled();
        expect(service.redis.set).not.toHaveBeenCalledWith(
            'replication:secondary:last_error',
            expect.anything()
        );
    });
});
