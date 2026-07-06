import { describe, it, expect } from 'vitest';
import { loadFilterQuerySchema } from '../../src/validation/loadSchemas.js';

describe('loadFilterQuerySchema', () => {
  it('accepts valid numeric strings for filters', () => {
    const validData = {
      min_price: '500',
      max_price: '1500.50',
      distance: '10.5',
      order: 'asc'
    };
    const result = loadFilterQuerySchema.safeParse(validData);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      min_price: 500,
      max_price: 1500.5,
      distance: 10.5,
      order: 'asc'
    });
  });

  it('rejects malformed numeric strings', () => {
    const invalidData1 = { min_price: '500abc' };
    const invalidData2 = { distance: '100.5.5' };
    const invalidData3 = { max_price: 'NaN' };
    const invalidData4 = { min_price: '-10' };

    expect(loadFilterQuerySchema.safeParse(invalidData1).success).toBe(false);
    expect(loadFilterQuerySchema.safeParse(invalidData2).success).toBe(false);
    expect(loadFilterQuerySchema.safeParse(invalidData3).success).toBe(false);
    expect(loadFilterQuerySchema.safeParse(invalidData4).success).toBe(false);
  });

  it('rejects if min_price > max_price', () => {
    const invalidRange = {
      min_price: '2000',
      max_price: '1000'
    };
    const result = loadFilterQuerySchema.safeParse(invalidRange);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toContain('less than or equal to max_price');
  });
});
