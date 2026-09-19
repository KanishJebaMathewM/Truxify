import { describe, it, expect } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: { openapi: '3.0.0', info: { title: 'Truxify test API', version: '1.0.0' } },
  apis: ['src/routes/crossDockRoutes.js'],
});

describe('cross-dock OpenAPI contract', () => {
  it('documents every mounted cross-dock operation', () => {
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining([
      '/api/cross-dock/candidates',
      '/api/cross-dock',
      '/api/cross-dock/{id}',
      '/api/cross-dock/{id}/accept',
      '/api/cross-dock/{id}/decline',
      '/api/cross-dock/{id}/cancel',
      '/api/cross-dock/{id}/verify',
    ]));
    const expectedOperations = {
      '/api/cross-dock/candidates': 'get',
      '/api/cross-dock': 'post',
      '/api/cross-dock/{id}': 'get',
      '/api/cross-dock/{id}/accept': 'post',
      '/api/cross-dock/{id}/decline': 'post',
      '/api/cross-dock/{id}/cancel': 'post',
      '/api/cross-dock/{id}/verify': 'post',
    };

    for (const [path, method] of Object.entries(expectedOperations)) {
      expect(spec.paths[path]).toHaveProperty(method);
    }
  });

  it('declares authentication and request contracts', () => {
    expect(spec.components.securitySchemes.BearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    for (const path of Object.keys(spec.paths)) {
      for (const operation of Object.values(spec.paths[path])) {
        expect(operation.security).toEqual([{ BearerAuth: [] }]);
        expect(operation.responses).toHaveProperty('401');
      }
    }
    expect(spec.paths['/api/cross-dock'].post.requestBody).toBeDefined();
    expect(spec.paths['/api/cross-dock/{id}/verify'].post.requestBody).toBeDefined();
  });
});
