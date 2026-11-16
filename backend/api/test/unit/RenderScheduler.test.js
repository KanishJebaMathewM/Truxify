import { describe, it, expect, vi, beforeEach } from 'vitest';
import RenderScheduler, { Priority, PriorityNames } from '../../../scheduler/RenderScheduler.js';

describe('RenderScheduler', () => {
  let scheduler;

  beforeEach(() => {
    scheduler = new RenderScheduler({ maxConcurrent: 2 });
  });

  it('creates a scheduler with default options', () => {
    const s = new RenderScheduler({});
    expect(s).toBeDefined();
  });

  it('schedule returns a numeric taskId', () => {
    // Task ids are sequential integers; scheduler/routes.js parses them back
    // with parseInt for cancel and priority changes.
    const id = scheduler.schedule('test-component', Priority.MEDIUM, {});
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThan(0);
    expect(scheduler.schedule('next', Priority.MEDIUM, {})).toBe(id + 1);
  });

  it('cancel returns true for scheduled task', () => {
    const id = scheduler.schedule('test-component', Priority.HIGH);
    expect(scheduler.cancel(id)).toBe(true);
  });

  it('cancel returns false for unknown taskId', () => {
    expect(scheduler.cancel('unknown-id')).toBe(false);
  });

  it('cancelAll with no priority returns count', () => {
    scheduler.schedule('c1', Priority.MEDIUM);
    scheduler.schedule('c2', Priority.MEDIUM);
    const count = scheduler.cancelAll(null);
    expect(typeof count).toBe('number');
  });

  it('Priority and PriorityNames are exported', () => {
    expect(Priority.MEDIUM).toBeDefined();
    expect(PriorityNames[Priority.MEDIUM]).toBe('MEDIUM');
  });
});
