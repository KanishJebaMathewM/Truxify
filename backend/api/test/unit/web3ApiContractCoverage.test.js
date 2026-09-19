import { describe, it, expect } from 'vitest';
import { swaggerSpec } from '../../src/config/swagger.js';

const expectedPaths = [
  '/api/zkid/identity/create',
  '/api/zkid/credential/issue',
  '/api/zkid/credential/verify/{credentialHash}',
  '/api/zkid/credential/revoke',
  '/api/zkid/verification/challenge',
  '/api/zkid/verification/request',
  '/api/zkid/disclosure/create',
  '/api/zkid/disclosure/revoke',
  '/api/zkid/identity/{identityHash}',
  '/api/zkid/stats',
  '/api/dao/join',
  '/api/dao/leave',
  '/api/dao/proposal/create',
  '/api/dao/vote/cast',
  '/api/dao/proposal/execute',
  '/api/dao/proposal/{proposalId}',
  '/api/dao/member/{userAddress}',
  '/api/dao/stats',
  '/api/mev/commitment',
  '/api/mev/escrow',
  '/api/mev/release/{escrowId}',
  '/api/mev/flashbots/{escrowId}',
  '/api/mev/protection/{escrowId}',
  '/api/mev/escrow/{escrowId}',
  '/api/mev/stats',
];

describe('ZK-ID, DAO and MEV OpenAPI contract', () => {
  it('contains every mounted endpoint', () => {
    for (const path of expectedPaths) {
      expect(swaggerSpec.paths, 'missing OpenAPI path ' + path).toHaveProperty(path);
    }
  });

  it('marks protected endpoint families with BearerAuth', () => {
    for (const path of expectedPaths.filter((value) => ![
      '/api/dao/proposal/{proposalId}',
      '/api/dao/member/{userAddress}',
      '/api/dao/stats',
    ].includes(value))) {
      const operations = swaggerSpec.paths[path];
      for (const operation of Object.values(operations)) {
        expect(operation.security).toEqual([{ BearerAuth: [] }]);
      }
    }
  });

  it('does not silently omit the HTTP operation for any documented path', () => {
    for (const path of expectedPaths) {
      const operations = swaggerSpec.paths[path];
      expect(Object.keys(operations).length).toBeGreaterThan(0);
    }
  });
});
