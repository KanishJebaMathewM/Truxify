import { describe, it, expect } from 'vitest';
import { swaggerSpec } from '../../src/config/swagger.js';

const expectedOperations = [
  ['/api/zkid/identity/create', 'post'],
  ['/api/zkid/credential/issue', 'post'],
  ['/api/zkid/credential/verify/{credentialHash}', 'get'],
  ['/api/zkid/credential/revoke', 'post'],
  ['/api/zkid/verification/challenge', 'post'],
  ['/api/zkid/verification/request', 'post'],
  ['/api/zkid/disclosure/create', 'post'],
  ['/api/zkid/disclosure/revoke', 'post'],
  ['/api/zkid/identity/{identityHash}', 'get'],
  ['/api/zkid/stats', 'get'],
  ['/api/dao/join', 'post'],
  ['/api/dao/leave', 'post'],
  ['/api/dao/proposal/create', 'post'],
  ['/api/dao/vote/cast', 'post'],
  ['/api/dao/proposal/execute', 'post'],
  ['/api/dao/proposal/{proposalId}', 'get'],
  ['/api/dao/member/{userAddress}', 'get'],
  ['/api/dao/stats', 'get'],
  ['/api/mev/commitment', 'post'],
  ['/api/mev/escrow', 'post'],
  ['/api/mev/release/{escrowId}', 'post'],
  ['/api/mev/flashbots/{escrowId}', 'post'],
  ['/api/mev/protection/{escrowId}', 'get'],
  ['/api/mev/escrow/{escrowId}', 'get'],
  ['/api/mev/stats', 'get'],
];

describe('ZK-ID, DAO and MEV OpenAPI contract', () => {
  it('contains every mounted endpoint', () => {
    for (const [path, method] of expectedOperations) {
      expect(swaggerSpec.paths, 'missing OpenAPI path ' + path).toHaveProperty(path);
      expect(swaggerSpec.paths[path], 'missing OpenAPI method ' + method + ' for ' + path).toHaveProperty(method);
    }
  });

  it('defines BearerAuth and applies it to protected endpoints only', () => {
    expect(swaggerSpec.components.securitySchemes.BearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });

    const publicPaths = new Set([
      '/api/dao/proposal/{proposalId}',
      '/api/dao/member/{userAddress}',
      '/api/dao/stats',
    ]);

    for (const [path] of expectedOperations) {
      const operations = swaggerSpec.paths[path];

      for (const operation of Object.values(operations)) {
        if (publicPaths.has(path)) {
          expect(operation.security).toBeUndefined();
        } else {
          expect(operation.security).toEqual([{ BearerAuth: [] }]);
        }
      }
    }
  });

  it('does not silently omit the HTTP operation for any documented path', () => {
    for (const [path] of expectedOperations) {
      const operations = swaggerSpec.paths[path];
      expect(Object.keys(operations).length).toBeGreaterThan(0);
    }
  });
});
