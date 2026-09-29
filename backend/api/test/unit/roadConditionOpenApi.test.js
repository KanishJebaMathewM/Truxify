import { describe, expect, it } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: { openapi: '3.0.0', info: { title: 'Truxify API', version: '1.0.0' } },
  apis: ['./src/routes/roadConditionRoutes.js'],
});

describe('road condition OpenAPI contract', () => {
  it('documents every road condition endpoint', () => {
    expect(spec.paths['/api/road-conditions/grip']?.post).toBeDefined();
    expect(spec.paths['/api/road-conditions/grip/nearby']?.get).toBeDefined();
  });

  it('documents telemetry and nearby-report schemas', () => {
    expect(spec.components?.schemas?.RoadGripReport).toBeDefined();
    expect(spec.components?.schemas?.NearbyGripReportResponse).toBeDefined();
  });
});
