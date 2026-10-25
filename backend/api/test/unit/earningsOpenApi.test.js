import { describe, it, expect } from 'vitest';
import { swaggerSpec } from '../../src/config/swagger.js';

describe('Earnings OpenAPI contract', () => {
  it('documents the mounted earnings summary endpoint', () => {
    expect(swaggerSpec.paths, 'missing OpenAPI path /api/earnings/summary')
      .toHaveProperty('/api/earnings/summary');

    expect(swaggerSpec.paths['/api/earnings/summary'].get.security)
      .toEqual([{ BearerAuth: [] }]);
  });
});
