import { describe, it, expect, vi } from 'vitest';
import { validateBody } from '../../src/middleware/validate.js';
import {
  createOrderSchema,
  driverOnlineSchema,
  submitBidSchema,
} from '../../src/validation/requestSchemas.js';

function runValidation(schema, body) {
  const req = { body };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const next = vi.fn();

  validateBody(schema)(req, res, next);
  return { req, res, next };
}

describe('request validation middleware', () => {
  it('rejects invalid coordinates with field-level details', () => {
    const { res, next } = runValidation(createOrderSchema, {
      pickup_lat: 181,
      pickup_lng: 72.8777,
      drop_lat: 28.7041,
      drop_lng: 77.1025,
      weight_tonnes: 10,
      pickup_date: '2026-06-10',
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({
          field: 'pickup_lat',
          message: 'Must be less than or equal to 180',
        }),
      ]),
    });
  });

  it('rejects invalid ISO date strings', () => {
    const { res } = runValidation(createOrderSchema, {
      pickup_lat: 19.076,
      pickup_lng: 72.8777,
      drop_lat: 28.7041,
      drop_lng: 77.1025,
      weight_tonnes: 10,
      pickup_date: 'next week',
    });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({
          field: 'pickup_date',
          message: 'Must be a valid ISO date string',
        }),
      ]),
    });
  });

  it('rejects negative bid amounts', () => {
    const { res } = runValidation(submitBidSchema, { bid_amount: -1 });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({
          field: 'bid_amount',
          message: 'Must be greater than 0',
        }),
      ]),
    });
  });

  it('rejects invalid boolean values for driver online state', () => {
    const { res } = runValidation(driverOnlineSchema, { is_online: 'true' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({
          field: 'is_online',
          message: expect.any(String),
        }),
      ]),
    });
  });

  it('passes through valid payloads without stripping unrelated route fields', () => {
    const { req, res, next } = runValidation(createOrderSchema, {
      pickup_lat: 19.076,
      pickup_lng: 72.8777,
      drop_lat: 28.7041,
      drop_lng: 77.1025,
      weight_tonnes: 10,
      pickup_date: '2026-06-10',
      pickup_address: 'Mumbai',
      goods_type: 'electronics',
    });

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    expect(req.body.pickup_address).toBe('Mumbai');
    expect(req.body.goods_type).toBe('electronics');
  });
});
