import { describe, it, expect } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Truxify test API', version: '1.0.0' },
  },
  apis: ['src/routes/arLoadingRoutes.js'],
});

describe('AR loading verification OpenAPI contract', () => {
  it('documents the verification endpoint', () => {
    const operation = spec.paths['/api/ar-loading/verify/{planId}']?.post;
    expect(operation).toBeDefined();
    expect(operation.tags).toEqual(['AR Loading']);
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'planId',
          in: 'path',
          required: true,
        }),
      ])
    );
  });

  it('documents authentication and response outcomes', () => {
    const operation = spec.paths['/api/ar-loading/verify/{planId}'].post;
    expect(operation.security).toEqual([{ BearerAuth: [] }]);
    expect(operation.responses).toHaveProperty('200');
    expect(operation.responses).toHaveProperty('400');
    expect(operation.responses).toHaveProperty('401');
    expect(operation.responses).toHaveProperty('404');
    expect(operation.responses).toHaveProperty('429');
    expect(operation.responses).toHaveProperty('500');
    expect(spec.components.securitySchemes.BearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });
});
