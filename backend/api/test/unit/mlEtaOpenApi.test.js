import { describe, expect, it } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: { openapi: '3.0.0', info: { title: 'Truxify API', version: '1.0.0' } },
  apis: ['./src/routes/mlRoutes.js'],
});

describe('ML ETA OpenAPI contract', () => {
  it('documents the endpoint', () => {
    expect(spec.paths['/api/ml/eta']?.get).toBeDefined();
  });

  it('documents the reusable schemas', () => {
    expect(spec.components?.schemas?.MlEtaResponse).toBeDefined();
  });
});
