import { describe, it, expect } from 'vitest';
import { swaggerSpec } from '../../src/config/swagger.js';

const expectedPaths = [
  '/api/ebpf/metrics',
  '/api/ebpf/syscalls',
  '/api/ebpf/network',
  '/api/ebpf/security',
  '/api/ebpf/profile',
  '/api/ebpf/load',
  '/api/ebpf/unload',
  '/api/ebpf/unload-all',
  '/api/wasi/load',
  '/api/wasi/file/read',
  '/api/wasi/file/write',
  '/api/wasi/file/list',
  '/api/wasi/http',
  '/api/wasi/time',
  '/api/wasi/system',
  '/api/wasi/stats',
  '/api/wasm/route',
  '/api/wasm/drivers',
  '/api/wasm/optimize',
  '/api/wasm/eta',
  '/api/wasm/stats',
  '/api/snyk/scan/dependencies',
  '/api/snyk/scan/container',
  '/api/snyk/scan/iac',
  '/api/snyk/scan/code',
  '/api/snyk/monitor',
  '/api/snyk/vulnerabilities/{projectId}',
  '/api/snyk/fix-pr/{projectId}',
  '/api/snyk/projects',
  '/api/snyk/stats',
  '/api/liquibase/migrate',
  '/api/liquibase/rollback',
  '/api/liquibase/status',
  '/api/liquibase/validate',
];

const publicWasmPaths = new Set([
  '/api/wasm/route',
  '/api/wasm/drivers',
  '/api/wasm/optimize',
  '/api/wasm/eta',
]);

describe('Privileged operational OpenAPI contract', () => {
  it('contains every mounted operational endpoint', () => {
    for (const path of expectedPaths) {
      expect(swaggerSpec.paths, 'missing OpenAPI path ' + path).toHaveProperty(path);
    }
  });

  it('documents the actual protected/public boundary', () => {
    for (const path of expectedPaths) {
      for (const operation of Object.values(swaggerSpec.paths[path])) {
        if (publicWasmPaths.has(path)) {
          expect(operation.security).toBeUndefined();
        } else {
          expect(operation.security).toEqual([{ BearerAuth: [] }]);
        }
      }
    }
  });

  it('does not silently omit an HTTP method from the generated contract', () => {
    for (const path of expectedPaths) {
      expect(Object.keys(swaggerSpec.paths[path])).not.toHaveLength(0);
    }
  });
});
