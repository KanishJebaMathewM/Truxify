import { describe, it, expect } from 'vitest';
import {
  createOrderSchema,
  submitBidSchema,
  withdrawSchema,
  submitRatingSchema,
  driverOnlineSchema,
  predictDemandSchema,
  paramIdSchema,
  driverIdParamSchema,
  acceptBidParamsSchema,
} from '../../src/validation/requestSchemas.js';

// A minimal order that satisfies every required field, so each test can vary
// exactly one thing and attribute the failure to it.
function validOrder(overrides = {}) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    pickup_address: '12 Warehouse Road, Mumbai',
    pickup_lat: 19.076,
    pickup_lng: 72.877,
    drop_address: '44 Industrial Estate, Pune',
    drop_lat: 18.52,
    drop_lng: 73.856,
    pickup_date: tomorrow.toISOString(),
    goods_type: 'steel',
    weight_tonnes: 12,
    ...overrides,
  };
}

describe('createOrderSchema', () => {
  it('accepts a complete, valid order', () => {
    const result = createOrderSchema.safeParse(validOrder());
    expect(result.success).toBe(true);
  });

  describe('server-computed price fields', () => {
    // These are z.never(): a client must not be able to dictate what it pays.
    it.each([
      'base_freight',
      'toll_estimate',
      'platform_fee',
      'total_amount',
      'estimated_price',
    ])('rejects a client-supplied %s', (field) => {
      const result = createOrderSchema.safeParse(validOrder({ [field]: 1 }));
      expect(result.success).toBe(false);
    });
  });

  it('rejects unknown keys rather than silently dropping them', () => {
    const result = createOrderSchema.safeParse(validOrder({ smuggled_field: 'x' }));
    expect(result.success).toBe(false);
  });

  describe('coordinates', () => {
    it.each([
      ['pickup_lat', 91],
      ['pickup_lat', -91],
      ['drop_lat', 90.001],
      ['pickup_lng', 181],
      ['pickup_lng', -181],
      ['drop_lng', -180.5],
    ])('rejects out-of-range %s = %s', (field, value) => {
      const result = createOrderSchema.safeParse(validOrder({ [field]: value }));
      expect(result.success).toBe(false);
    });

    it.each([
      ['pickup_lat', 90],
      ['pickup_lat', -90],
      ['pickup_lng', 180],
      ['pickup_lng', -180],
    ])('accepts the boundary value %s = %s', (field, value) => {
      const result = createOrderSchema.safeParse(validOrder({ [field]: value }));
      expect(result.success).toBe(true);
    });

    it('coerces a numeric string coordinate', () => {
      const result = createOrderSchema.safeParse(validOrder({ pickup_lat: '19.076' }));
      expect(result.success).toBe(true);
      expect(result.data.pickup_lat).toBe(19.076);
    });

    it('rejects a non-numeric coordinate string', () => {
      const result = createOrderSchema.safeParse(validOrder({ pickup_lat: 'north' }));
      expect(result.success).toBe(false);
    });
  });

  describe('pickup_date', () => {
    it('rejects a date in the past', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const result = createOrderSchema.safeParse(
        validOrder({ pickup_date: yesterday.toISOString() })
      );
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error.issues)).toContain('Pickup date cannot be in the past');
    });

    it('accepts today', () => {
      const result = createOrderSchema.safeParse(
        validOrder({ pickup_date: new Date().toISOString() })
      );
      expect(result.success).toBe(true);
    });
  });

  describe('weight_tonnes', () => {
    it.each([0, -1, 101])('rejects %s', (weight) => {
      const result = createOrderSchema.safeParse(validOrder({ weight_tonnes: weight }));
      expect(result.success).toBe(false);
    });

    it('accepts the 100 tonne legal ceiling', () => {
      const result = createOrderSchema.safeParse(validOrder({ weight_tonnes: 100 }));
      expect(result.success).toBe(true);
    });

    it('coerces a numeric string', () => {
      const result = createOrderSchema.safeParse(validOrder({ weight_tonnes: '12.5' }));
      expect(result.success).toBe(true);
      expect(result.data.weight_tonnes).toBe(12.5);
    });
  });

  describe('addresses', () => {
    it.each(['pickup_address', 'drop_address'])('rejects a too-short %s', (field) => {
      const result = createOrderSchema.safeParse(validOrder({ [field]: 'ab' }));
      expect(result.success).toBe(false);
    });

    it('rejects an address over 255 characters', () => {
      const result = createOrderSchema.safeParse(validOrder({ pickup_address: 'a'.repeat(256) }));
      expect(result.success).toBe(false);
    });
  });

  describe('pickup_time', () => {
    it.each(['09:30', '00:00', '23:59'])('accepts %s', (time) => {
      expect(createOrderSchema.safeParse(validOrder({ pickup_time: time })).success).toBe(true);
    });

    it.each(['9:30am', '24:00', '12:60', 'noon'])('rejects %s', (time) => {
      expect(createOrderSchema.safeParse(validOrder({ pickup_time: time })).success).toBe(false);
    });
  });

  describe('waypoints', () => {
    it('accepts well-formed waypoints', () => {
      const result = createOrderSchema.safeParse(
        validOrder({ waypoints: [{ address: '9 Transit Hub, Lonavala', lat: 18.75, lng: 73.4 }] })
      );
      expect(result.success).toBe(true);
    });

    it('rejects a waypoint with an out-of-range coordinate', () => {
      const result = createOrderSchema.safeParse(
        validOrder({ waypoints: [{ address: '9 Transit Hub, Lonavala', lat: 200, lng: 73.4 }] })
      );
      expect(result.success).toBe(false);
    });
  });

  describe('dimensions', () => {
    it.each([
      ['length_ft', 61],
      ['width_ft', 16],
      ['height_ft', 16],
    ])('rejects %s above its maximum (%s)', (field, value) => {
      expect(createOrderSchema.safeParse(validOrder({ [field]: value })).success).toBe(false);
    });

    it.each(['length_ft', 'width_ft', 'height_ft'])('rejects a zero %s', (field) => {
      expect(createOrderSchema.safeParse(validOrder({ [field]: 0 })).success).toBe(false);
    });
  });
});

describe('submitBidSchema', () => {
  it('accepts a positive integer bid', () => {
    expect(submitBidSchema.safeParse({ bid_amount: 25000 }).success).toBe(true);
  });

  it.each([0, -1, 1500.5])('rejects %s', (bid_amount) => {
    expect(submitBidSchema.safeParse({ bid_amount }).success).toBe(false);
  });

  it('rejects extra keys', () => {
    expect(submitBidSchema.safeParse({ bid_amount: 100, driver_id: 'x' }).success).toBe(false);
  });
});

describe('withdrawSchema', () => {
  it('accepts a positive paisa amount', () => {
    expect(withdrawSchema.safeParse({ amount: 50000 }).success).toBe(true);
  });

  it.each([0, -100, 12.34])('rejects %s', (amount) => {
    expect(withdrawSchema.safeParse({ amount }).success).toBe(false);
  });

  it('rejects an amount beyond the safe integer range', () => {
    expect(withdrawSchema.safeParse({ amount: Number.MAX_SAFE_INTEGER + 2 }).success).toBe(false);
  });
});

describe('submitRatingSchema', () => {
  it.each([1, 3, 5])('accepts %s stars', (stars) => {
    expect(submitRatingSchema.safeParse({ stars }).success).toBe(true);
  });

  it.each([0, 6, 4.5])('rejects %s stars', (stars) => {
    expect(submitRatingSchema.safeParse({ stars }).success).toBe(false);
  });

  it('accepts an optional comment and trims it', () => {
    const result = submitRatingSchema.safeParse({ stars: 4, comment: '  solid trip  ' });
    expect(result.success).toBe(true);
    expect(result.data.comment).toBe('solid trip');
  });

  it('rejects a comment over 1000 characters', () => {
    const result = submitRatingSchema.safeParse({ stars: 4, comment: 'x'.repeat(1001) });
    expect(result.success).toBe(false);
  });

  it('allows a null comment', () => {
    expect(submitRatingSchema.safeParse({ stars: 4, comment: null }).success).toBe(true);
  });
});

describe('driverOnlineSchema', () => {
  it('accepts a boolean', () => {
    expect(driverOnlineSchema.safeParse({ is_online: true }).success).toBe(true);
  });

  it('rejects a string, so "false" cannot read as online', () => {
    expect(driverOnlineSchema.safeParse({ is_online: 'false' }).success).toBe(false);
  });
});

describe('predictDemandSchema', () => {
  const validDemand = (overrides = {}) => ({
    hour: 12,
    day_of_week: 3,
    temperature: 28.5,
    precipitation: 0,
    historical_volume: 140,
    nearby_drivers: 12,
    ...overrides,
  });

  it('accepts hour and day_of_week at their bounds', () => {
    expect(predictDemandSchema.safeParse(validDemand({ hour: 0, day_of_week: 0 })).success).toBe(true);
    expect(predictDemandSchema.safeParse(validDemand({ hour: 23, day_of_week: 6 })).success).toBe(true);
  });

  it.each([
    ['hour', 24],
    ['hour', -1],
    ['day_of_week', 7],
    ['day_of_week', -1],
  ])('rejects %s = %s', (field, value) => {
    expect(predictDemandSchema.safeParse(validDemand({ [field]: value })).success).toBe(false);
  });

  it.each(['precipitation', 'historical_volume', 'nearby_drivers'])(
    'rejects a negative %s',
    (field) => {
      expect(predictDemandSchema.safeParse(validDemand({ [field]: -1 })).success).toBe(false);
    },
  );

  it.each(['temperature', 'precipitation', 'historical_volume', 'nearby_drivers'])(
    'requires %s',
    (field) => {
      const payload = validDemand();
      delete payload[field];
      expect(predictDemandSchema.safeParse(payload).success).toBe(false);
    },
  );

  it('allows a sub-zero temperature', () => {
    expect(predictDemandSchema.safeParse(validDemand({ temperature: -4 })).success).toBe(true);
  });
});

describe('param schemas', () => {
  it('paramIdSchema requires a non-empty id', () => {
    expect(paramIdSchema.safeParse({ id: 'order-1' }).success).toBe(true);
    expect(paramIdSchema.safeParse({ id: '' }).success).toBe(false);
  });

  it('driverIdParamSchema requires a UUID', () => {
    expect(
      driverIdParamSchema.safeParse({ driverId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }).success
    ).toBe(true);
    expect(driverIdParamSchema.safeParse({ driverId: 'driver-1' }).success).toBe(false);
  });

  it('acceptBidParamsSchema requires both ids', () => {
    expect(acceptBidParamsSchema.safeParse({ id: 'o1', bidId: 'b1' }).success).toBe(true);
    expect(acceptBidParamsSchema.safeParse({ id: 'o1', bidId: '' }).success).toBe(false);
  });
});
