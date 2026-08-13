import { describe, it, expect } from 'vitest';
import { sortOrderIdsDeterministically } from '../../scripts/backfill-orders.js';
describe('sortOrderIdsDeterministically', () => {
  it('ascending', () => { expect(sortOrderIdsDeterministically(['c','a','b'])).toEqual(['a','b','c']); });
});
