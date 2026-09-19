import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerJsdoc from 'swagger-jsdoc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'WebRTC route contract',
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
  apis: [path.resolve(__dirname, '../../src/routes/webrtcRoutes.js')],
});

describe('WebRTC offline sync OpenAPI contract', () => {
  it('documents the offline sync operation and request contract', () => {
    const operation = swaggerSpec.paths['/api/webrtc/sync/{peerId}']?.post;

    expect(operation).toBeDefined();
    expect(operation.security).toEqual([{ BearerAuth: [] }]);
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'path',
          name: 'peerId',
          required: true,
          schema: { type: 'string' },
        }),
      ]),
    );

    expect(operation.requestBody.required).toBe(true);
    expect(operation.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/WebRTCOfflineSyncRequest',
    });

    expect(operation.responses).toEqual(
      expect.objectContaining({
        '200': expect.any(Object),
        '400': expect.any(Object),
        '403': expect.any(Object),
        '500': expect.any(Object),
        '503': expect.any(Object),
      }),
    );

    expect(swaggerSpec.components.schemas.WebRTCOfflineSyncRequest).toMatchObject({
      type: 'object',
      required: ['ackedIds'],
      properties: {
        ackedIds: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
        },
      },
    });

    expect(swaggerSpec.components.schemas.WebRTCOfflineSyncResponse).toMatchObject({
      type: 'object',
      required: ['success', 'message'],
    });
  });
});