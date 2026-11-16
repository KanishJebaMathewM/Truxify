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

describe('WebRTC offline GPS OpenAPI contract', () => {
  it('documents the offline GPS operation and query contract', () => {
    const operation = swaggerSpec.paths['/webrtc/offline/{peerId}']?.get;

    expect(operation).toBeDefined();
    expect(operation.security).toEqual([{ BearerAuth: [] }]);
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'path',
          name: 'peerId',
          required: true,
        }),
        expect.objectContaining({
          in: 'query',
          name: 'since',
          required: true,
          schema: expect.objectContaining({
            type: 'integer',
            minimum: 0,
          }),
        }),
      ]),
    );

    expect(operation.responses).toEqual(
      expect.objectContaining({
        '200': expect.any(Object),
        '400': expect.any(Object),
        '403': expect.any(Object),
        '500': expect.any(Object),
        '503': expect.any(Object),
      }),
    );

    expect(swaggerSpec.components.schemas.WebRTCOfflineGPSRecord).toMatchObject({
      type: 'object',
      required: ['id', 'data', 'timestamp', 'synced'],
      properties: expect.objectContaining({
        id: expect.objectContaining({ type: 'string' }),
        data: expect.objectContaining({ type: 'object', additionalProperties: true }),
        timestamp: expect.objectContaining({ type: 'integer', format: 'int64' }),
        synced: expect.objectContaining({ type: 'boolean' }),
      }),
    });

    expect(swaggerSpec.components.schemas.WebRTCOfflineGPSResponse).toMatchObject({
      type: 'object',
      required: ['success', 'data'],
    });
  });
});