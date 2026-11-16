import { describe, it, expect, beforeEach } from 'vitest';
import RenderScheduler from '../scheduler/RenderScheduler.js';

// backend/scheduler/RenderScheduler.test.js (Excerpt)

describe('RenderScheduler Cancellation & Unblocking', () => {
  it('unlinks cancelled task and lets unblocked dependents become schedulable', () => {
    const scheduler = new RenderScheduler();
    
    // Setup tasks with dependencies
    scheduler.addTask('taskA', () => {});
    scheduler.addTask('taskB', ['taskA'], () => {}); // depends on A

    // Cancel taskA
    scheduler.cancel('taskA');

    // Assertions reflecting the unblocking contract
    expect(scheduler.taskMap.has('taskA')).toBe(false); // Cancelled task leaves taskMap
    expect(scheduler.taskMap.has('taskB')).toBe(true);  // Dependent survives
    
    // taskB should now have no remaining dependencies and be ready for scheduling
    expect(scheduler.getSchedulableTasks()).toContain('taskB');
  });

  it('retains dependent in taskMap with surviving dependencies still blocking execution', () => {
    const scheduler = new RenderScheduler();
    
    scheduler.addTask('taskA', () => {});
    scheduler.addTask('taskB', () => {});
    scheduler.addTask('taskC', ['taskA', 'taskB'], () => {}); // depends on both A and B

    // Cancel only taskA
    scheduler.cancel('taskA');

    // Assertions
    expect(scheduler.taskMap.has('taskA')).toBe(false); // taskA is removed
    expect(scheduler.taskMap.has('taskC')).toBe(true);  // dependent C survives
    
    // taskC should still be blocked because taskB is uncompleted/un-cancelled
    expect(scheduler.getSchedulableTasks()).not.toContain('taskC');
  });
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
