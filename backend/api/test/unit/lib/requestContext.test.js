import { describe, it, expect } from 'vitest';
import { requestContext } from '../../../src/lib/requestContext.js';

describe('requestContext', () => {
  it('runs callback within AsyncLocalStorage store', () => {
    const store = { requestId: 'req-abc' };
    requestContext.run(store, () => {
      expect(requestContext.getStore()).toEqual({ requestId: 'req-abc' });
    });
  });
});
