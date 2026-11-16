import { describe, it, expect } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Truxify test API', version: '1.0.0' },
  },
  apis: ['src/routes/mlRoutes.js'],
});

describe('ML A/B-testing status OpenAPI contract', () => {
  it('documents the admin status endpoint', () => {
    const operation = spec.paths['/api/ml/ab-testing/status']?.get;
    expect(operation).toBeDefined();
    expect(operation.tags).toEqual(['ML A/B Testing']);
    expect(operation.summary).toBe('Get ML A/B-testing status');
  });

  it('documents authentication and status response schema', () => {
    const operation = spec.paths['/api/ml/ab-testing/status'].get;
    expect(operation.security).toEqual([{ BearerAuth: [] }]);
    expect(operation.responses).toHaveProperty('200');
    expect(operation.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/MlAbTestingStatusResponse',
    });
    expect(operation.responses).toHaveProperty('401');
    expect(operation.responses).toHaveProperty('403');
    expect(operation.responses).toHaveProperty('429');
    expect(operation.responses).toHaveProperty('502');

    const schema = spec.components.schemas.MlAbTestingStatusResponse;
    expect(schema).toBeDefined();
    expect(schema.required).toEqual(['status', 'active_test', 'timestamp']);
    expect(schema.properties.status.enum).toEqual(['active']);
    expect(schema.properties.active_test).toMatchObject({
      type: 'object',
      nullable: true,
      required: ['test_id', 'production_version', 'shadow_version', 'started_at', 'status'],
      properties: expect.objectContaining({
        test_id: expect.objectContaining({ type: 'string' }),
        production_version: expect.objectContaining({ type: 'string' }),
        shadow_version: expect.objectContaining({ type: 'string' }),
        started_at: expect.objectContaining({ type: 'string', format: 'date-time' }),
        status: expect.objectContaining({ type: 'string' }),
      }),
    });
    expect(schema.properties.timestamp.format).toBe('date-time');
    expect(spec.components.securitySchemes.BearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });
});
