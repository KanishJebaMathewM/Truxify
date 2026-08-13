import { describe, it, expect } from 'vitest';
import { validatePagination } from '../../src/utils/validatePagination.js';
describe('validatePagination', () => {
  it('accepts default', () => { expect(validatePagination().error).toBeUndefined(); });
  it('rejects huge page', () => {
    const r = validatePagination({ page: 100_000 });
    expect(r.error).toBeDefined();
    expect(r.status).toBe(400);
  });
  it('rejects negative page', () => { expect(validatePagination({ page: -1 }).error).toBeDefined(); });
  it('rejects oversize pageSize', () => { expect(validatePagination({ pageSize: 500 }).error).toBeDefined(); });
});
