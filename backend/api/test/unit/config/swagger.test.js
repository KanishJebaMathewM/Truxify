import { describe, it, expect } from 'vitest';
import { setupSwagger } from '../../../src/config/swagger.js';

describe('Swagger Config', () => {
  it('exports setupSwagger function', () => {
    expect(typeof setupSwagger).toBe('function');
  });
});
