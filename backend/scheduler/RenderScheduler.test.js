import { describe, it, expect, beforeEach } from 'vitest';
import RenderScheduler from '../scheduler/RenderScheduler.js';

describe('RenderScheduler cancelled dependency handling', () => {
    let scheduler;

    beforeEach(() => {
        scheduler = new RenderScheduler({ maxConcurrent: 1 });
        scheduler.pause();
    });

    it('releases dependents when a dependency is cancelled', () => {
        const depId = scheduler.schedule(() => 'dep', 2);
        const taskId = scheduler.schedule(() => 'task', 2);
        scheduler.addDependency(taskId, depId);

        expect(scheduler.getTask(taskId).dependencies).toContain(depId);

        const cancelled = scheduler.cancel(depId);
        expect(cancelled).toBe(true);

        const dependent = scheduler.getTask(taskId);
        expect(dependent).toBeDefined();
        expect(dependent.dependencies).not.toContain(depId);
        expect(scheduler.areDependenciesMet(dependent)).toBe(true);
    });

    it('removes the cancelled task and unblocked dependents from taskMap', () => {
        const depId = scheduler.schedule(() => 'dep', 2);
        const taskId = scheduler.schedule(() => 'task', 2);
        scheduler.addDependency(taskId, depId);

        scheduler.cancel(depId);

        expect(scheduler.getTask(depId)).toBeUndefined();
        expect(scheduler.getTask(taskId)).toBeUndefined();
        expect(scheduler.taskMap.size).toBe(0);
    });

    it('prunes a dependent blocked forever by a cancelled dependency', () => {
        const depId = scheduler.schedule(() => 'dep', 2);
        const taskId = scheduler.schedule(() => 'task', 2);
        const otherDepId = scheduler.schedule(() => 'other', 2);
        scheduler.addDependency(taskId, depId);
        scheduler.addDependency(taskId, otherDepId);

        scheduler.cancel(depId);

        expect(scheduler.getTask(depId)).toBeUndefined();
        expect(scheduler.getTask(otherDepId)).toBeDefined();
        expect(scheduler.getTask(taskId)).toBeUndefined();
        expect(scheduler.taskMap.size).toBe(1);
    });
});
