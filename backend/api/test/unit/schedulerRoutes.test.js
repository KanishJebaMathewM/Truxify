import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockScheduler = {
  schedule: vi.fn(() => 'task_123'),
  cancel: vi.fn(() => true),
  cancelAll: vi.fn((priority) => priority === null ? 5 : 2),
};

vi.mock('../../../../scheduler/RenderScheduler.js', () => {
  const RenderScheduler = class {
    constructor() { return mockScheduler; }
  };
  RenderScheduler.Priority = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, IDLE: 4 };
  RenderScheduler.PriorityNames = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'IDLE'];
  return { default: RenderScheduler, ...vi.importActual('../../../../scheduler/RenderScheduler.js') };
});

import schedulerRouter from '../../../../scheduler/routes.js';

describe('scheduler routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockScheduler.schedule.mockReturnValue('task_123');
    mockScheduler.cancel.mockReturnValue(true);
    mockScheduler.cancelAll.mockReturnValue(2);
    app = express();
    app.use(express.json());
    app.use(schedulerRouter);
  });

  it('POST /scheduler/schedule returns 200 with taskId', async () => {
    const res = await request(app)
      .post('/scheduler/schedule')
      .send({ component: 'render', priority: 'HIGH', metadata: { foo: 'bar' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.taskId).toBe('task_123');
  });

  it('POST /scheduler/schedule returns 400 when component is missing', async () => {
    const res = await request(app)
      .post('/scheduler/schedule')
      .send({ priority: 'HIGH' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('DELETE /scheduler/task/:taskId returns 200 on success', async () => {
    const res = await request(app).delete('/scheduler/task/42');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /scheduler/tasks cancels all when no priority', async () => {
    const res = await request(app).delete('/scheduler/tasks');
    expect(res.status).toBe(200);
    expect(res.body.data.cancelled).toBe(5);
  });

  it('DELETE /scheduler/tasks returns 400 for invalid priority', async () => {
    const res = await request(app).delete('/scheduler/tasks?priority=INVALID');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Invalid priority');
  });

  it('DELETE /scheduler/tasks cancels by priority when valid', async () => {
    const res = await request(app).delete('/scheduler/tasks?priority=CRITICAL');
    expect(res.status).toBe(200);
    expect(mockScheduler.cancelAll).toHaveBeenCalledWith(0);
  });
});
