import { describe, it, expect } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: { openapi: '3.0.0', info: { title: 'Truxify test API', version: '1.0.0' } },
  apis: ['src/routes/iotRoutes.js'],
});

describe('IoT telemetry OpenAPI contract', () => {
  it('documents both telemetry operations', () => {
    const pathItem = spec.paths['/api/iot/telemetry/{id}'];
    expect(pathItem).toBeDefined();
    expect(pathItem).toHaveProperty('post');
    expect(pathItem).toHaveProperty('get');
  });

  it('declares bearer authentication and request/response contracts', () => {
    expect(spec.components.securitySchemes.BearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });

    const pathItem = spec.paths['/api/iot/telemetry/{id}'];
    expect(pathItem.post.security).toEqual([{ BearerAuth: [] }]);
    expect(pathItem.get.security).toEqual([{ BearerAuth: [] }]);
    expect(pathItem.post.requestBody).toBeDefined();
    expect(pathItem.post.responses['400']).toBeDefined();
    expect(pathItem.post.responses['403']).toBeDefined();
    expect(pathItem.post.responses['404']).toBeDefined();
    expect(pathItem.post.responses['500']).toBeDefined();
    expect(pathItem.get.responses['200']).toBeDefined();
  });
});
