import { beforeEach, describe, it, expect, vi } from 'vitest';

const { anonFrom, adminFrom, query } = vi.hoisted(() => {
  const anonFrom = vi.fn(() => {
    throw new Error('anon Supabase client must not access events');
  });
  const query = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { event_id: 'evt-9202' },
      error: null,
    }),
    single: vi.fn().mockResolvedValue({
      data: { event_id: 'evt-save-9202' },
      error: null,
    }),
  };
  const adminFrom = vi.fn(() => query);
  return { anonFrom, adminFrom, query };
});

vi.mock('../../api/src/config/db.js', () => ({
  supabase: { from: anonFrom },
  supabaseAdmin: { from: adminFrom },
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import eventRepository from '../repositories/event.repository.js';

describe('EventRepository service-role access (issue #9202)', () => {
  beforeEach(() => {
    anonFrom.mockClear();
    adminFrom.mockClear();
    query.insert.mockClear();
    query.select.mockClear();
    query.eq.mockClear();
    query.maybeSingle.mockClear();
    query.single.mockClear();
  });

  it('uses supabaseAdmin for the service-role-only events table', async () => {
    await expect(eventRepository.getEventById('evt-9202')).resolves.toEqual({ event_id: 'evt-9202' });

    expect(adminFrom).toHaveBeenCalledWith('events');
    expect(anonFrom).not.toHaveBeenCalled();
  });

  it('uses supabaseAdmin for protected event writes', async () => {
    const event = {
      eventId: 'evt-save-9202',
      eventType: 'ORDER_CREATED',
      orderId: 'order-9202',
      data: { status: 'created' },
      metadata: {},
      timestamp: '2026-09-13T15:30:00.000Z',
    };

    await expect(eventRepository.saveEvent(event)).resolves.toEqual({ event_id: 'evt-save-9202' });

    expect(adminFrom).toHaveBeenCalledWith('events');
    expect(query.insert).toHaveBeenCalledWith([expect.objectContaining({
      event_id: 'evt-save-9202',
      order_id: 'order-9202',
    })]);
    expect(anonFrom).not.toHaveBeenCalled();
  });
});
