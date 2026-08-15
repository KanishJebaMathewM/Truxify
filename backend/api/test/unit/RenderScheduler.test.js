import { describe, it, expect, vi, beforeEach } from 'vitest';
import RenderScheduler, { Priority, PriorityNames } from '../../../../scheduler/RenderScheduler.js';

describe('RenderScheduler', () => {
  let scheduler;

  beforeEach(() => {
    scheduler = new RenderScheduler({ maxConcurrent: 2 });
  });

  it('creates a scheduler with default options', () => {
    const s = new RenderScheduler({});
    expect(s).toBeDefined();
  });

  it('schedule returns a taskId string', () => {
    const id = scheduler.schedule('test-component', Priority.MEDIUM, {});
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
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
