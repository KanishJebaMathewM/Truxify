import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

const { dbState } = vi.hoisted(() => ({
  dbState: { firebaseAdmin: null },
}));

vi.mock('../../src/config/db.js', () => ({
  get firebaseAdmin() { return dbState.firebaseAdmin; },
  get supabase() { return null; },
  get redisClient() { return null; },
  get pgPool() { return null; },
  get mongoDb() { return null; },
}));

import { HealthStatus } from '../../src/core/health/HealthCheck.js';
import firebaseHealth from '../../src/core/health/checks/firebaseHealth.js';

describe('firebaseHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.firebaseAdmin = null;
  });

  it('reports degraded when firebase is not configured', async () => {
    const result = await firebaseHealth({ timeoutMs: 500 });
    expect(result.name).toBe('firebase');
    expect(result.status).toBe(HealthStatus.DEGRADED);
    expect(result.message).toBe('not_configured');
  });

  it('reports healthy when firebase admin is present', async () => {
    dbState.firebaseAdmin = {};
    const result = await firebaseHealth({ timeoutMs: 500 });
    expect(result.status).toBe(HealthStatus.HEALTHY);
  });
});
