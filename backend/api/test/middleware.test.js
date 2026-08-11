/**
 * Unit tests for backend/api/src/middleware/index.js
 */
import { describe, it, expect } from 'vitest';

describe('middleware index', () => {
  it('exports middleware modules as an object', async () => {
    const middleware = await import('../../src/middleware/index.js');
    expect(middleware).toBeDefined();
    expect(typeof middleware).toBe('object');
  });
});
