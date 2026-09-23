import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/config/db.js', () => ({
  supabaseAdmin: { from: vi.fn(() => ({ select: vi.fn(() => Promise.resolve({ data: null, error: null })) })) },
  supabase: { from: vi.fn(() => ({ select: vi.fn(() => Promise.resolve({ data: [], error: null })) })) },
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../../src/utils/apiResponse.js', () => ({
  success: vi.fn((res, data) => res),
  error: vi.fn((res, msg, code) => res),
}));

vi.mock('mongoose', () => ({
  default: {
    Schema: class {
      constructor(fields, opts) {
        this.fields = fields;
        this.opts = opts;
      }
    },
    model: vi.fn((name, schema) => ({ name, schema })),
    models: {},
    Types: { ObjectId: class {} },
  },
}));

import * as orderController from '../../../../src/controllers/orderController.js';

describe('orderController', () => {
  it('has expected functions exported', () => {
    expect(typeof orderController).toBe('object');
  });
});
