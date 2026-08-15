import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../../src/config/db.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: [], error: null })),
    })),
  },
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../../src/utils/apiResponse.js', () => ({
  errorResponse: vi.fn(),
}));

import * as documentController from '../../../../src/controllers/documentController.js';

describe('documentController', () => {
  it('has reportGripData exported', () => {
    expect(typeof documentController.reportGripData).toBe('function');
  });

  it('has getNearbyGripData exported', () => {
    expect(typeof documentController.getNearbyGripData).toBe('function');
  });
});
