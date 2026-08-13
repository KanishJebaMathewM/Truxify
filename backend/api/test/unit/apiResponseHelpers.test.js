import { describe, it, expect, vi, beforeEach } from 'vitest';
import { success, error } from '../../src/utils/apiResponseHelpers.js';

describe('apiResponseHelpers', () => {
  describe('success', () => {
    it('returns success response with data', () => {
      const data = { id: 1, name: 'Item' };
      const res = success(data);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(data);
    });

    it('includes meta when provided', () => {
      const data = { items: [] };
      const meta = { page: 1, total: 100 };
      const res = success(data, meta);
      expect(res.success).toBe(true);
      expect(res.meta).toEqual(meta);
    });

    it('works without arguments', () => {
      const res = success();
      expect(res.success).toBe(true);
    });
  });

  describe('error', () => {
    it('returns error response with message', () => {
      const res = error('Something went wrong');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Something went wrong');
    });

    it('includes code when provided', () => {
      const res = error('Not found', 'NOT_FOUND');
      expect(res.error).toBe('Not found');
      expect(res.code).toBe('NOT_FOUND');
    });

    it('includes details when provided', () => {
      const res = error('Validation failed', 'VALIDATION', { field: 'id' });
      expect(res.success).toBe(false);
      expect(res.details).toEqual({ field: 'id' });
    });
  });
});
