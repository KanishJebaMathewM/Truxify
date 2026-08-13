import { describe, it, expect } from 'vitest';
import { RESERVE_OUTBOX_SQL, isReservationResult } from '../../repositories/outbox.repository.js';
describe('reservation', () => {
  it('SQL', () => { expect(RESERVE_OUTBOX_SQL).toContain('SKIP LOCKED'); });
  it('is array', () => { expect(isReservationResult([1])).toBe(true); });
});
