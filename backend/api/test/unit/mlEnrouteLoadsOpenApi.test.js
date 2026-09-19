import { describe, expect, it } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: { openapi: '3.0.0', info: { title: 'Truxify API', version: '1.0.0' } },
  apis: ['./src/routes/mlRoutes.js'],
});

describe('ML en-route loads OpenAPI contract', () => {
  const operation = spec.paths['/api/ml/enroute-loads']?.get;

  it('documents the endpoint and authentication', () => {
    expect(operation).toBeDefined();
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
  });

  it('documents coordinate bounds and maxDetour validation', () => {
    const parameters = operation.parameters ?? [];
    const lat = parameters.find((parameter) => parameter.name === 'lat');
    const lng = parameters.find((parameter) => parameter.name === 'lng');
    const maxDetour = parameters.find((parameter) => parameter.name === 'maxDetour');

    expect(lat?.required).toBe(true);
    expect(lat?.schema).toMatchObject({ minimum: -90, maximum: 90 });
    expect(lng?.required).toBe(true);
    expect(lng?.schema).toMatchObject({ minimum: -180, maximum: 180 });
    expect(maxDetour?.schema).toMatchObject({ minimum: 0, maximum: 500 });
  });

  it('documents success and error response schemas', () => {
    expect(operation.responses?.['200']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/MlEnrouteLoadsResponse',
    });
    expect(operation.responses?.['400']).toBeDefined();
    expect(operation.responses?.['500']).toBeDefined();
    expect(spec.components?.schemas?.MlEnrouteLoadRecommendation).toBeDefined();
    expect(spec.components?.schemas?.MlEnrouteLoadsResponse).toBeDefined();
  });
});
