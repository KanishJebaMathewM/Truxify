import { describe, it, expect } from 'vitest';
import { swaggerSpec } from '../../src/config/swagger.js';

describe('Carbon Credit OpenAPI contract', () => {
  it('documents all mounted carbon credit endpoints', () => {
    expect(swaggerSpec.paths).toHaveProperty('/api/carbon-credits/mint');
    expect(swaggerSpec.paths).toHaveProperty('/api/carbon-credits/purchase');
    expect(swaggerSpec.paths).toHaveProperty('/api/carbon-credits/{tokenId}');
  });

  it('documents Bearer authentication on every carbon credit endpoint', () => {
    for (const path of [
      '/api/carbon-credits/mint',
      '/api/carbon-credits/purchase',
      '/api/carbon-credits/{tokenId}',
    ]) {
      for (const operation of Object.values(swaggerSpec.paths[path])) {
        expect(operation.security).toEqual([{ BearerAuth: [] }]);
      }
    }
  });
});
