import { describe, expect, it } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: { openapi: '3.0.0', info: { title: 'Truxify API', version: '1.0.0' } },
  apis: ['./src/routes/mlRoutes.js'],
});

describe('ML ETA OpenAPI contract', () => {
  const operation = spec.paths['/api/ml/eta']?.get;

  it('documents the endpoint and authentication', () => {
    expect(operation).toBeDefined();
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
  });

  it('documents all ETA model inputs and cache dimensions', () => {
    const parameters = operation.parameters ?? [];
    for (const name of [
      'routeDistance',
      'timeOfDay',
      'dayOfWeek',
      'routeType',
      'historicalSpeed',
      'tripId',
      'lat',
      'lng',
    ]) {
      expect(parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name, in: 'query' }),
        ]),
      );
    }
  });

  it('documents the ETA fallback response schema', () => {
    expect(operation.responses?.['200']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/MlEtaResponse',
    });
    expect(spec.components?.schemas?.MlEtaResponse).toBeDefined();
  });
});
