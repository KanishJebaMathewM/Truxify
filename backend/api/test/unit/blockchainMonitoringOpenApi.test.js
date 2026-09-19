import { describe, expect, it } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: { openapi: '3.0.0', info: { title: 'Truxify API', version: '1.0.0' } },
  apis: ['./src/routes/blockchainMonitoringRoutes.js'],
});

describe('blockchain monitoring OpenAPI contract', () => {
  const expectedPaths = [
    ['/api/blockchain/health', 'get'],
    ['/api/blockchain/metrics', 'get'],
    ['/api/blockchain/alerts/active', 'get'],
    ['/api/blockchain/alerts/{alertId}/resolve', 'post'],
    ['/api/blockchain/events', 'get'],
    ['/api/blockchain/escalations/{alertId}', 'get'],
  ];

  it('documents every blockchain monitoring endpoint', () => {
    for (const [path, method] of expectedPaths) {
      expect(spec.paths[path]?.[method]).toBeDefined();
    }
  });

  it('documents response schemas', () => {
    expect(spec.components?.schemas?.BlockchainHealth).toBeDefined();
    expect(spec.components?.schemas?.BlockchainEventsResponse).toBeDefined();
    expect(spec.components?.schemas?.EscalationResponse).toBeDefined();
  });
});
