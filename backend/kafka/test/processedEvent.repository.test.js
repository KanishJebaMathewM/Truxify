/**
 * Unit tests for backend/kafka/repositories/processedEvent.repository.js
 *
 * Regression test for issue #6288: the idempotency registry must write via
 * the service-role client (supabaseAdmin) so RLS on kafka_processed_events
 * (service_role only) does not reject every claim.
 *
 * Coverage:
 *   - first claim for a (topic, event_id) returns true
 *   - duplicate claim for the same (topic, event_id) returns false
 *   - the claim is issued through the service-role client (supabaseAdmin)
 *
 * Run with:  npm test -- test/processedEvent.repository.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertedKeys = new Set();

vi.mock('../../api/src/config/db.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      upsert: vi.fn((record) => ({
        select: vi.fn(() => {
          const key = `${record.topic}:${record.event_id}`;
          if (insertedKeys.has(key)) {
            return Promise.resolve({ data: [], error: null });
          }
          insertedKeys.add(key);
          return Promise.resolve({ data: [{ event_id: record.event_id }], error: null });
        }),
      })),
    })),
  },
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import processedEventRepository from '../../repositories/processedEvent.repository.js';
import { supabaseAdmin } from '../../api/src/config/db.js';

describe('ProcessedEventRepository.claimProcessed', () => {
  beforeEach(() => {
    insertedKeys.clear();
    vi.clearAllMocks();
  });

  it('returns true the first time an event is claimed', async () => {
    const claimed = await processedEventRepository.claimProcessed('payment.confirmed', 'evt-001');
    expect(claimed).toBe(true);
  });

  it('returns false when the same (topic, event_id) is claimed again', async () => {
    await processedEventRepository.claimProcessed('payment.confirmed', 'evt-001');
    const second = await processedEventRepository.claimProcessed('payment.confirmed', 'evt-001');
    expect(second).toBe(false);
  });

  it('treats different topics as distinct idempotency keys', async () => {
    await processedEventRepository.claimProcessed('payment.confirmed', 'evt-001');
    const otherTopic = await processedEventRepository.claimProcessed('trip.completed', 'evt-001');
    expect(otherTopic).toBe(true);
  });

  it('issues the claim through the service-role client (supabaseAdmin)', async () => {
    await processedEventRepository.claimProcessed('payment.confirmed', 'evt-001');
    expect(supabaseAdmin.from).toHaveBeenCalledWith('kafka_processed_events');
  });
});
