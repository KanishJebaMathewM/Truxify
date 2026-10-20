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

    // The deliberate contract (see cancel(): 'Removing the edge lets a
    // dependent with no other dependencies become schedulable again') is
    // UNBLOCKING, not pruning — the cancelled task leaves taskMap, the
    // dependent survives and becomes schedulable. The sibling test above
    // ('removes the dependency edge from dependents') pins the same contract.
    it('removes the cancelled task and unblocks its dependents', () => {
        const depId = scheduler.schedule(() => 'dep', 2);
        const taskId = scheduler.schedule(() => 'task', 2);
        scheduler.addDependency(taskId, depId);

        scheduler.cancel(depId);

        expect(scheduler.getTask(depId)).toBeUndefined();
        const dependent = scheduler.getTask(taskId);
        expect(dependent).toBeDefined();
        expect(dependent.dependencies).not.toContain(depId);
        expect(scheduler.areDependenciesMet(dependent)).toBe(true);
        expect(scheduler.taskMap.size).toBe(1);
    });

    it('keeps a dependent with a surviving dependency pending after a cancellation', () => {
        const depId = scheduler.schedule(() => 'dep', 2);
        const taskId = scheduler.schedule(() => 'task', 2);
        const otherDepId = scheduler.schedule(() => 'other', 2);
        scheduler.addDependency(taskId, depId);
        scheduler.addDependency(taskId, otherDepId);

        scheduler.cancel(depId);

        expect(scheduler.getTask(depId)).toBeUndefined();
        expect(scheduler.getTask(otherDepId)).toBeDefined();
        // The cancelled edge is gone, the surviving one still blocks.
        const dependent = scheduler.getTask(taskId);
        expect(dependent).toBeDefined();
        expect(dependent.dependencies).not.toContain(depId);
        expect(dependent.dependencies).toContain(otherDepId);
        expect(scheduler.areDependenciesMet(dependent)).toBe(false);
        expect(scheduler.taskMap.size).toBe(2);
    });
});
