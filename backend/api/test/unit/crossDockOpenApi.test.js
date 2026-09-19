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
    expect(spec.paths['/api/cross-dock']).toHaveProperty('get');
    expect(spec.paths['/api/cross-dock']).toHaveProperty('post');
    expect(spec.paths['/api/cross-dock/{id}']).toHaveProperty('get');
  });

  it('declares authentication and request contracts', () => {
    expect(spec.components.securitySchemes.BearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    for (const path of Object.keys(spec.paths)) {
      for (const operation of Object.values(spec.paths[path])) {
        if (operation.security) expect(operation.security).toEqual([{ BearerAuth: [] }]);
      }
    }
    expect(spec.paths['/api/cross-dock'].post.requestBody).toBeDefined();
    expect(spec.paths['/api/cross-dock/{id}/verify'].post.requestBody).toBeDefined();
  });
});
