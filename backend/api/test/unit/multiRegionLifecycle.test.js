import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
});