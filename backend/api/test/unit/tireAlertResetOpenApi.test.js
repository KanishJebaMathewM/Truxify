import { describe, it, expect } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Truxify test API', version: '1.0.0' },
  },
  apis: ['src/routes/tireAnalyticsRoutes.js'],
});

describe('tire alert reset OpenAPI contract', () => {
  it('documents the reset endpoint and truck identifier', () => {
    const operation = spec.paths['/api/tire-analytics/reset/{truckId}']?.post;
    expect(operation).toBeDefined();
    expect(operation.tags).toEqual(['Tire Analytics']);
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'truckId',
          in: 'path',
          required: true,
        }),
      ])
    );
  });

  it('documents a truckId pattern that compiles and matches TRUCK_ID_REGEX', () => {
    const param = spec.paths['/api/tire-analytics/reset/{truckId}'].post.parameters
      .find((p) => p.name === 'truckId');
    // A doubled backslash in the YAML yields `\\-:`, an out-of-order range.
    const documented = new RegExp(param.schema.pattern);
    expect(documented.source).toBe('^[a-zA-Z0-9_\\-:.]{1,64}$');
    expect(documented.test('TRUCK-101')).toBe(true);
    expect(documented.test('truck:a.b_c')).toBe(true);
    expect(documented.test('TRUCK 101')).toBe(false);
    expect(documented.test('a'.repeat(65))).toBe(false);
  });

  it('documents authentication, authorization, and response outcomes', () => {
    const operation = spec.paths['/api/tire-analytics/reset/{truckId}'].post;
    expect(operation.security).toEqual([{ BearerAuth: [] }]);
    for (const status of ['200', '400', '401', '403', '404', '429', '500']) {
      expect(operation.responses).toHaveProperty(status);
    }
    expect(spec.components.securitySchemes.BearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });
});
