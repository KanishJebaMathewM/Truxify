import { describe, it, expect } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Truxify test API', version: '1.0.0' },
  },
  apis: ['src/routes/voice.routes.js'],
});

describe('Voice Assistant OpenAPI contract', () => {
  it('documents the multipart request and supported language values', () => {
    const operation = spec.paths['/api/v1/voice/assistant']?.post;
    expect(operation).toBeDefined();
    expect(operation.tags).toEqual(['Voice']);
    expect(operation.requestBody.required).toBe(true);

    const schema = operation.requestBody.content['multipart/form-data'].schema;
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['audio']);
    expect(schema.properties.audio).toEqual(
      expect.objectContaining({
        type: 'string',
        format: 'binary',
      })
    );
    expect(schema.properties.language.enum).toEqual([
      'en',
      'hi',
      'bn',
      'ta',
      'te',
      'mr',
      'gu',
      'kn',
      'ml',
    ]);
    expect(schema.properties.language.default).toBe('en');
  });

  it('documents authentication, audio response, and error responses', () => {
    const operation = spec.paths['/api/v1/voice/assistant'].post;
    expect(operation.security).toEqual([{ BearerAuth: [] }]);
    for (const status of ['200', '400', '401', '413', '429', '500']) {
      expect(operation.responses).toHaveProperty(status);
    }

    const responseSchema = operation.responses['200'].content['audio/mpeg'].schema;
    expect(responseSchema).toEqual({
      type: 'string',
      format: 'binary',
    });

    expect(spec.components.securitySchemes.BearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(spec.components.schemas.VoiceAssistantError.required).toEqual(['error']);
  });
});
