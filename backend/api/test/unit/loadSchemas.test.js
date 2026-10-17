import { describe, it, expect } from 'vitest';
import { loadFilterQuerySchema, createLoadSchema } from '../../src/validation/loadSchemas.js';

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

const validLoad = {
  origin: { lat: 19.076, lng: 72.8777, address: 'Mumbai, MH' },
  destination: { lat: 28.6139, lng: 77.209, address: 'Delhi, DL' },
  weight_tons: 12,
  expected_price: 45000,
  material_type: 'Steel',
};

describe('createLoadSchema coordinate bounds', () => {
  it('accepts a well-formed load', () => {
    const result = createLoadSchema.safeParse(validLoad);
    expect(result.success).toBe(true);
    expect(result.data.origin.lat).toBe(19.076);
    expect(result.data.destination.lng).toBe(77.209);
  });

  it('accepts numeric strings and coerces them', () => {
    const result = createLoadSchema.safeParse({
      ...validLoad,
      origin: { lat: '19.076', lng: '72.8777' },
    });
    expect(result.success).toBe(true);
    expect(result.data.origin.lat).toBe(19.076);
  });

  it('accepts the exact range boundaries', () => {
    const result = createLoadSchema.safeParse({
      ...validLoad,
      origin: { lat: -90, lng: -180 },
      destination: { lat: 90, lng: 180 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts 0 as a real coordinate instead of treating it as missing', () => {
    const result = createLoadSchema.safeParse({
      ...validLoad,
      origin: { lat: 0, lng: 0 },
    });
    expect(result.success).toBe(true);
    expect(result.data.origin.lat).toBe(0);
    expect(result.data.origin.lng).toBe(0);
  });

  it('rejects out-of-range latitudes', () => {
    for (const lat of [90.0001, -90.0001, 999, -999]) {
      const result = createLoadSchema.safeParse({
        ...validLoad,
        origin: { lat, lng: 72.8777 },
      });
      expect(result.success, `lat ${lat} should be rejected`).toBe(false);
    }
  });

  it('rejects out-of-range longitudes', () => {
    for (const lng of [180.0001, -180.0001, 999, -999]) {
      const result = createLoadSchema.safeParse({
        ...validLoad,
        destination: { lat: 19.076, lng },
      });
      expect(result.success, `lng ${lng} should be rejected`).toBe(false);
    }
  });

  it('rejects null coordinates instead of coercing them to Null Island', () => {
    const result = createLoadSchema.safeParse({
      ...validLoad,
      origin: { lat: null, lng: null },
    });
    expect(result.success).toBe(false);
  });

  it('rejects blank-string coordinates instead of coercing them to 0', () => {
    const result = createLoadSchema.safeParse({
      ...validLoad,
      origin: { lat: '', lng: '   ' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric coordinates', () => {
    for (const lat of ['abc', '12abc', NaN, Infinity, -Infinity, {}]) {
      const result = createLoadSchema.safeParse({
        ...validLoad,
        origin: { lat, lng: 72.8777 },
      });
      expect(result.success, `lat ${String(lat)} should be rejected`).toBe(false);
    }
  });
});

describe('createLoadSchema amount validation', () => {
  it('rejects non-finite prices that .positive() alone would accept', () => {
    for (const price of [Infinity, -Infinity, 'Infinity', '1e999']) {
      const result = createLoadSchema.safeParse({ ...validLoad, expected_price: price });
      expect(result.success, `price ${String(price)} should be rejected`).toBe(false);
    }
  });

  it('rejects non-finite weights', () => {
    for (const weight of [Infinity, 'Infinity', NaN]) {
      const result = createLoadSchema.safeParse({ ...validLoad, weight_tons: weight });
      expect(result.success, `weight ${String(weight)} should be rejected`).toBe(false);
    }
  });

  it('still enforces the 50-tonne weight ceiling', () => {
    const result = createLoadSchema.safeParse({ ...validLoad, weight_tons: 51 });
    expect(result.success).toBe(false);
  });
});
