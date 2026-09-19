import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerJsdoc from 'swagger-jsdoc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Drone route contract',
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
  apis: [path.resolve(__dirname, '../../src/routes/droneRoutes.js')],
});

describe('Drone launch OpenAPI contract', () => {
  it('documents the launch operation and access requirements', () => {
    const operation = swaggerSpec.paths['/drone/launch']?.post;

    expect(operation).toBeDefined();
    expect(operation.security).toEqual([{ BearerAuth: [] }]);
    expect(operation.description).toMatch(/driver.*dispatcher.*admin/i);
    expect(operation.requestBody).toMatchObject({
      required: true,
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/DroneLaunchRequest',
          },
        },
      },
    });
  });

  it('documents the complete launch request constraints', () => {
    const schema = swaggerSpec.components.schemas.DroneLaunchRequest;
    const gps = swaggerSpec.components.schemas.DroneGpsCoordinate;

    expect(schema).toMatchObject({
      type: 'object',
      required: ['trip_id', 'parcel_id', 'safe_zone_gps', 'destination_gps'],
      properties: expect.objectContaining({
        trip_id: expect.objectContaining({
          type: 'string',
          pattern: '^[a-zA-Z0-9_\-:.]{1,64}$',
          minLength: 1,
          maxLength: 64,
        }),
        parcel_id: expect.objectContaining({
          type: 'string',
          pattern: '^[a-zA-Z0-9_\-:.]{1,64}$',
          minLength: 1,
          maxLength: 64,
        }),
        safe_zone_gps: {
          $ref: '#/components/schemas/DroneGpsCoordinate',
        },
        destination_gps: {
          $ref: '#/components/schemas/DroneGpsCoordinate',
        },
      }),
    });

    expect(gps).toMatchObject({
      type: 'object',
      required: ['lat', 'lng'],
      properties: expect.objectContaining({
        lat: expect.objectContaining({ type: 'number', minimum: -90, maximum: 90 }),
        lng: expect.objectContaining({ type: 'number', minimum: -180, maximum: 180 }),
      }),
    });
  });

  it('documents launch responses and the 25 km safety limit', () => {
    const operation = swaggerSpec.paths['/drone/launch'].post;
    const responseSchema = swaggerSpec.components.schemas.DroneLaunchResponse;
    const errorSchema = swaggerSpec.components.schemas.DroneLaunchErrorResponse;

    expect(operation.responses).toEqual(
      expect.objectContaining({
        '201': expect.any(Object),
        '400': expect.any(Object),
        '401': expect.any(Object),
        '403': expect.any(Object),
        '429': expect.any(Object),
        '500': expect.any(Object),
      }),
    );

    expect(operation.responses['400'].description).toMatch(/25 km/i);
    expect(operation.responses['400'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/DroneLaunchErrorResponse',
    });
    expect(operation.responses['403'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/DroneLaunchErrorResponse',
    });
    expect(operation.responses['500'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/DroneLaunchErrorResponse',
    });
    expect(errorSchema).toMatchObject({
      type: 'object',
      required: ['error'],
      properties: expect.objectContaining({
        error: expect.objectContaining({ type: 'string' }),
        maxRadiusKm: expect.objectContaining({
          type: 'number',
          minimum: 0,
          maximum: 25,
        }),
      }),
    });

    expect(responseSchema).toMatchObject({
      type: 'object',
      required: ['message', 'flightDistanceKm', 'mission'],
      properties: expect.objectContaining({
        flightDistanceKm: expect.objectContaining({
          type: 'number',
          minimum: 0,
        }),
        mission: expect.objectContaining({
          type: 'object',
          additionalProperties: true,
        }),
      }),
    });
  });
});
