import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock } from '../helpers/supabaseMock.js';

const supabaseMock = createSupabaseMock();

const redisClientMock = {
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
};

vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseMock.supabase,
  supabaseAdmin: supabaseMock.supabase,
  redisClient: redisClientMock,
  firebaseAdmin: null,
  mongoDb: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/core/telemetry/WorkerTracer.js', () => ({
  WorkerTracer: {
    wrapCronJob: (_jobName, handler) => handler,
  },
}));

const { pruneStaleDevices } = await import('../../src/workers/devicePruningWorker.js');

const DAY_MS = 24 * 60 * 60 * 1000;

function seedDevices(rows) {
  supabaseMock.store.user_devices = rows.map((r, i) => ({
    id: r.id ?? `device-${i}`,
    fcm_token: r.fcm_token ?? `token-${i}`,
    user_id: r.user_id ?? 'user-1',
    platform: 'android',
    is_active: r.is_active ?? true,
    last_seen: r.last_seen ?? new Date().toISOString(),
  }));
}

describe('pruneStaleDevices', () => {
  beforeEach(() => {
    supabaseMock.reset();
    redisClientMock.set.mockClear();
    redisClientMock.del.mockClear();
    redisClientMock.set.mockResolvedValue('OK');
    supabaseMock.store.user_devices = [];
  });

  it('deactivates devices whose last_seen is older than the threshold', async () => {
    seedDevices([
      { id: 'stale-1', last_seen: new Date(Date.now() - 120 * DAY_MS).toISOString() },
      { id: 'fresh-1', last_seen: new Date(Date.now() - 1 * DAY_MS).toISOString() },
    ]);

    await pruneStaleDevices();

    const stale = supabaseMock.store.user_devices.find((d) => d.id === 'stale-1');
    const fresh = supabaseMock.store.user_devices.find((d) => d.id === 'fresh-1');
    expect(stale.is_active).toBe(false);
    expect(stale.deactivated_at).toBeTruthy();
    expect(fresh.is_active).toBe(true);
  });

  it('never deactivates already-inactive devices (idempotent sweep)', async () => {
    seedDevices([
      { id: 'already-off', is_active: false, last_seen: new Date(Date.now() - 200 * DAY_MS).toISOString() },
    ]);

    await pruneStaleDevices();

    const row = supabaseMock.store.user_devices.find((d) => d.id === 'already-off');
    expect(row.is_active).toBe(false);
    // last_seen is not touched because the guarded UPDATE filters on active rows
    expect(row.deactivated_at).toBeUndefined();
  });

  it('skips the sweep when the Redis lock is already held by another replica', async () => {
    redisClientMock.set.mockResolvedValue(false);
    seedDevices([{ id: 'stale-1', last_seen: new Date(Date.now() - 200 * DAY_MS).toISOString() }]);

    await pruneStaleDevices();

    expect(supabaseMock.store.user_devices.find((d) => d.id === 'stale-1').is_active).toBe(true);
    expect(redisClientMock.del).not.toHaveBeenCalled();
  });

  it('releases the lock after a successful sweep', async () => {
    seedDevices([{ id: 'fresh-1', last_seen: new Date().toISOString() }]);

    await pruneStaleDevices();

    expect(redisClientMock.set).toHaveBeenCalled();
    expect(redisClientMock.del).toHaveBeenCalled();
  });
});
