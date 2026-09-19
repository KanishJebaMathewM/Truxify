import { describe, expect, it } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: { openapi: '3.0.0', info: { title: 'Truxify API', version: '1.0.0' } },
  apis: ['./src/routes/escortWalletRoutes.js'],
});

describe('escort wallet OpenAPI contract', () => {
  it('documents credential issuance and convoy handshake', () => {
    expect(spec.paths['/api/escorts/wallet/credential']?.post).toBeDefined();
    expect(spec.paths['/api/escorts/wallet/handshake']?.post).toBeDefined();
  });

  it('documents request and response schemas', () => {
    expect(spec.components?.schemas?.EscortCredentialRequest).toBeDefined();
    expect(spec.components?.schemas?.EscortHandshakeResponse).toBeDefined();
  });
});
