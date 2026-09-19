import { describe, expect, it } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: { openapi: '3.0.0', info: { title: 'Truxify API', version: '1.0.0' } },
  apis: ['./src/routes/mlRoutes.js'],
});

describe('ML en-route loads OpenAPI contract', () => {
  it('documents the endpoint', () => {
    expect(spec.paths['/api/ml/enroute-loads']?.get).toBeDefined();
  });

  it('documents the reusable schemas', () => {
    expect(spec.components?.schemas?.MlEnrouteLoadRecommendation).toBeDefined();
    expect(spec.components?.schemas?.MlEnrouteLoadsResponse).toBeDefined();
  });
});
