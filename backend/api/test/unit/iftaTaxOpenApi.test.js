import { describe, it, expect } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';
import { generateIftaReport } from '../../src/services/iftaTax.js';

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Truxify test API', version: '1.0.0' },
  },
  apis: ['src/routes/iftaTax.js'],
});

const operation = spec.paths['/api/ifta-tax/generate-report']?.post;

describe('IFTA report OpenAPI contract', () => {
  it('documents the request body the handler requires', () => {
    const schema = operation.requestBody.content['application/json'].schema;
    expect(operation.requestBody.required).toBe(true);
    expect(schema.required).toEqual(['truckId', 'waypoints']);
    expect(schema.properties.waypoints.items.required).toEqual(['latitude', 'longitude']);
    expect(Object.keys(schema.properties.fuelPurchases.items.properties).sort())
      .toEqual(['gallons', 'jurisdictionState', 'taxPaidUSD']);
  });

  it('documents every status the handler and auth chain return', () => {
    expect(operation.security).toEqual([{ BearerAuth: [] }]);
    expect(Object.keys(operation.responses).sort()).toEqual(['200', '400', '401', '403', '413', '500']);
  });

  it('documents exactly the fields generateIftaReport returns', () => {
    const report = generateIftaReport({
      truckId: 'TRUCK-1',
      waypoints: [
        { latitude: 30, longitude: -97, jurisdictionState: 'TX' },
        { latitude: 30.1, longitude: -97, jurisdictionState: 'TX' },
      ],
      fuelPurchases: [{ jurisdictionState: 'TX', gallons: 10, taxPaidUSD: 2 }],
    });
    const data = operation.responses['200'].content['application/json'].schema.properties.data;

    expect(Object.keys(data.properties).sort()).toEqual(Object.keys(report).sort());
    expect(Object.keys(data.properties.summary.properties).sort()).toEqual(Object.keys(report.summary).sort());
    expect(Object.keys(data.properties.jurisdictionBreakdown.items.properties).sort())
      .toEqual(Object.keys(report.jurisdictionBreakdown[0]).sort());
  });
});
