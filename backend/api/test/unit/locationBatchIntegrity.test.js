import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ from: vi.fn(), history: vi.fn(), current: vi.fn(), read: vi.fn() }));
vi.mock('../../src/config/db.js', () => ({ supabase: { from: db.from }, supabaseAdmin: { from: db.from } }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../src/services/notificationService.js', () => ({ default: {} }));

import { syncLocations } from '../../src/controllers/deviceController.js';

const point = (time = '2026-10-06T10:00:00.000Z') => ({ latitude: 28.6, longitude: 77.2, recorded_at: time });
async function sync(locations, user = { id: 'driver-a' }) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  await syncLocations({ user, body: { locations } }, res, next);
  return { res, next };
}

describe('offline location batch integrity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    db.history.mockResolvedValue({ error: null });
    db.current.mockResolvedValue({ error: null });
    db.read.mockResolvedValue({ data: null, error: null });
    db.from.mockImplementation(table => table === 'driver_location_history'
      ? { upsert: db.history }
      : { upsert: db.current, select: vi.fn(() => ({ eq: vi.fn(() => ({ single: db.read })) })) });
  });
  afterEach(() => vi.useRealTimers());

  it('keeps valid points when null and invalid timestamps occur in the same batch', async () => {
    const { res, next } = await sync([point(), null, point('invalid-date'), point('2026-10-06T11:00:00Z')]);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Synced 2 locations' });
    expect(db.history.mock.calls[0][0]).toHaveLength(2);
    expect(db.current.mock.calls[0][0].recorded_at).toBe('2026-10-06T11:00:00.000Z');
  });

  it('rejects an all-null batch as bad input without touching the database', async () => {
    const { res, next } = await sync([null, null]);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('rejects an all-invalid-time batch instead of forwarding a RangeError', async () => {
    const { res, next } = await sync([point('not-a-date'), point('999999999999999999999999')]);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('skips non-record entries and out-of-range coordinates', async () => {
    const { res, next } = await sync([true, 'point', [], { ...point(), latitude: 91 }, point()]);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Synced 1 locations' });
  });

  it('normalizes valid timezones and preserves the newest-point selection', async () => {
    const { res } = await sync([point('2026-10-06T12:00:00+02:00'), point('2026-10-06T10:30:00Z')]);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Synced 2 locations' });
    expect(db.history.mock.calls[0][0][0].recorded_at).toBe('2026-10-06T10:00:00.000Z');
    expect(db.current.mock.calls[0][0].recorded_at).toBe('2026-10-06T10:30:00.000Z');
  });

  it('retains the capture-time fallback and does not overwrite a newer current location', async () => {
    db.read.mockResolvedValue({ data: { recorded_at: '2026-10-06T13:00:00Z' }, error: null });
    await sync([{ latitude: 28.6, longitude: 77.2 }]);
    expect(db.history.mock.calls[0][0][0].recorded_at).toBe('2026-10-06T12:00:00.000Z');
    expect(db.current).not.toHaveBeenCalled();
  });

  it('preserves authentication and history-write error handling', async () => {
    const unauthenticated = await sync([point()], null);
    expect(unauthenticated.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(db.from).not.toHaveBeenCalled();
    db.history.mockResolvedValue({ error: { message: 'write failed' } });
    const failed = await sync([point()]);
    expect(failed.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    expect(db.current).not.toHaveBeenCalled();
  });
});
