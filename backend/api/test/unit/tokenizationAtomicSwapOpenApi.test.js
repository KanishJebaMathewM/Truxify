import { describe, it, expect } from 'vitest';
import { swaggerSpec } from '../../src/config/swagger.js';

const expectedPaths = [
  '/api/token/asset/create',
  '/api/token/fraction/purchase',
  '/api/token/fraction/sell',
  '/api/token/trade/create',
  '/api/token/trade/execute',
  '/api/token/asset/{assetId}',
  '/api/token/ownership/{assetId}',
  '/api/token/stats',
  '/api/swap/create',
  '/api/swap/execute',
  '/api/swap/refund',
  '/api/swap/cross-chain/create',
  '/api/swap/cross-chain/execute',
  '/api/swap/cross-chain/refund',
  '/api/swap/stats',
  '/api/swap/{swapId}',
  '/api/swap/cross-chain/{swapId}',
];

const publicPaths = new Set([
  '/api/token/asset/{assetId}',
  '/api/token/stats',
]);

describe('Tokenization and atomic-swap OpenAPI contract', () => {
  it('contains every mounted endpoint', () => {
    for (const path of expectedPaths) {
      expect(swaggerSpec.paths, 'missing OpenAPI path ' + path).toHaveProperty(path);
    }
  });

  it('marks protected endpoints with BearerAuth and leaves public token lookups public', () => {
    for (const path of expectedPaths) {
      for (const operation of Object.values(swaggerSpec.paths[path])) {
        if (publicPaths.has(path)) {
          expect(operation.security).toBeUndefined();
        } else {
          expect(operation.security).toEqual([{ BearerAuth: [] }]);
        }
      }
    }
  });

  it('preserves an HTTP operation for every documented path', () => {
    for (const path of expectedPaths) {
      expect(Object.keys(swaggerSpec.paths[path])).not.toHaveLength(0);
    }
  });
});
