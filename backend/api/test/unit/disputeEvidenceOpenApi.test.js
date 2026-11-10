import { describe, it, expect } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Truxify test API', version: '1.0.0' },
  },
  apis: ['src/routes/internalRoutes.js'],
});

describe('dispute evidence OpenAPI contract', () => {
  const operation = spec.paths['/api/internal/dispute-evidence/{orderId}']?.get;

  it('declares the orderId path parameter used by the path template', () => {
    expect(operation).toBeDefined();
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'orderId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        }),
      ])
    );
  });

  it('documents API-key auth and every status the handler returns', () => {
    expect(operation.security).toEqual([{ ApiKeyAuth: [] }]);
    for (const status of ['200', '401', '404', '500', '503']) {
      expect(operation.responses).toHaveProperty(status);
    }
  });
});
