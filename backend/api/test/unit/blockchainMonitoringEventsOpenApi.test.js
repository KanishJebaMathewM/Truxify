import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerJsdoc from 'swagger-jsdoc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Blockchain monitoring route contract',
      version: '1.0.0',
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: [path.resolve(__dirname, '../../src/routes/blockchainMonitoringRoutes.js')],
});

const expectedEventTypes = [
  'PAYMENT_RECEIVED',
  'PAYMENT_RELEASED',
  'BOOKING_CANCELLED',
  'BOOKING_STARTED',
  'BOOKING_DISPUTED',
  'DISPUTE_RESOLVED',
  'BOOKING_CREATED',
  'BLOCKCHAIN_STATE_DIVERGENCE',
  'SCAN_CHECKPOINT',
  'INSURANCE_CLAIM_APPROVED',
  'INSURANCE_CLAIM_REJECTED',
  'GEOFENCE_BREACH',
  'BALANCE_UPDATE_FAILED',
  'SMART_CONTRACT_REVERT',
];

describe('Blockchain monitoring events OpenAPI contract', () => {
  it('documents filters, security, and response schema', () => {
    const operation = swaggerSpec.paths['/blockchain/events']?.get;

    expect(operation).toBeDefined();
    expect(operation.security).toEqual([{ BearerAuth: [] }]);

    const parameters = operation.parameters;
    const typeParameter = parameters.find((parameter) => parameter.name === 'type');
    const severityParameter = parameters.find((parameter) => parameter.name === 'severity');
    const limitParameter = parameters.find((parameter) => parameter.name === 'limit');

    expect(typeParameter.schema.enum).toEqual(expectedEventTypes);
    expect(severityParameter.schema).toEqual({
      type: 'string',
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    });
    expect(limitParameter.schema).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 1000,
      default: 50,
    });

    expect(operation.responses).toEqual(
      expect.objectContaining({
        '200': expect.any(Object),
        '400': expect.any(Object),
        '500': expect.any(Object),
      }),
    );

    expect(swaggerSpec.components.schemas.BlockchainMonitoringEvent).toMatchObject({
      type: 'object',
      required: ['id', 'type', 'severity'],
      properties: expect.objectContaining({
        id: { type: 'integer', format: 'int64' },
        severity: {
          type: 'string',
          enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
        },
      }),
    });

    expect(swaggerSpec.components.schemas.BlockchainMonitoringEventsResponse).toMatchObject({
      type: 'object',
      required: ['timestamp', 'count', 'events'],
    });
  });
});