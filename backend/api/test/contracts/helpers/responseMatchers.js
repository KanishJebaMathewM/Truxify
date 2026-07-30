import { expect } from 'vitest';

export function expectContract(res, expectedStatus) {
  expect(res.status).toBe(expectedStatus);
  expect(res.headers['content-type']).toMatch(/json/);
}

export function expectErrorContract(res, expectedStatus) {
  expectContract(res, expectedStatus);
  expect(res.body).toHaveProperty('error');
  expect(typeof res.body.error).toBe('string');
}

export function expectValidationError(res) {
  expectErrorContract(res, 400);
  expect(res.body.error).toBe('Validation failed');
  expect(res.body).toHaveProperty('details');
  expect(Array.isArray(res.body.details)).toBe(true);
  if (res.body.details.length > 0) {
    const detail = res.body.details[0];
    expect(detail).toHaveProperty('field');
    expect(typeof detail.field).toBe('string');
    expect(detail).toHaveProperty('message');
    expect(typeof detail.message).toBe('string');
  }
}

export function expectServerError(res) {
  expectErrorContract(res, 500);
}

export function expectForbidden(res) {
  expectErrorContract(res, 403);
}

export function expectNotFound(res) {
  expectErrorContract(res, 404);
}

export function expectOrderShape(order) {
  expect(order).toHaveProperty('id');
  expect(typeof order.id).toBe('string');
  expect(order).toHaveProperty('order_display_id');
  expect(typeof order.order_display_id).toBe('string');
  expect(order).toHaveProperty('status');
  expect(typeof order.status).toBe('string');
  expect(order).toHaveProperty('created_at');
  expect(order.created_at).toBeTruthy();
}

export function expectTimelineEntryShape(entry) {
  expect(entry).toHaveProperty('order_display_id');
  expect(typeof entry.order_display_id).toBe('string');
  expect(entry).toHaveProperty('milestone');
  expect(typeof entry.milestone).toBe('string');
  expect(entry).toHaveProperty('completed');
  expect(typeof entry.completed).toBe('boolean');
  expect(entry).toHaveProperty('sort_order');
  expect(typeof entry.sort_order).toBe('number');
}

export function expectBidShape(bid) {
  expect(bid).toHaveProperty('id');
  expect(bid).toHaveProperty('bid_amount');
  expect(typeof bid.bid_amount).toBe('number');
  expect(bid).toHaveProperty('created_at');
}

export function expectPricingShape(pricing) {
  expect(pricing).toHaveProperty('base_freight');
  expect(typeof pricing.base_freight).toBe('number');
  expect(pricing).toHaveProperty('toll_estimate');
  expect(typeof pricing.toll_estimate).toBe('number');
  expect(pricing).toHaveProperty('platform_fee');
  expect(typeof pricing.platform_fee).toBe('number');
  expect(pricing).toHaveProperty('total_amount');
  expect(typeof pricing.total_amount).toBe('number');
}

export function expectEnrichedBidShape(bid) {
  expectBidShape(bid);
  expect(bid).toHaveProperty('driver');
  expect(typeof bid.driver).toBe('object');
  expect(bid.driver).toHaveProperty('id');
  expect(bid.driver).toHaveProperty('name');
  expect(bid.driver).toHaveProperty('rating');
  expect(bid.driver).toHaveProperty('trips');
}
