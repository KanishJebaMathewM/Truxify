import { describe, it, expect } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Truxify test API', version: '1.0.0' },
  },
  apis: ['src/routes/adminRoutes.js'],
});

const resolve = (ref) => ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], spec);

describe('admin withdrawal resolution OpenAPI contract', () => {
  it('uses OpenAPI path templating, not Express :id segments', () => {
    const paths = Object.keys(spec.paths);
    expect(paths).toContain('/api/v1/admin/withdrawals/{id}/retry');
    expect(paths).toContain('/api/v1/admin/withdrawals/{id}/refund');
    expect(paths.filter((p) => p.includes('/:'))).toEqual([]);
  });

  it.each([
    ['retry', ['200', '401', '403', '409', '500']],
    ['refund', ['200', '400', '401', '403', '500']],
  ])('documents %s with the id parameter, auth, notes body and handler statuses', (action, statuses) => {
    const operation = spec.paths[`/api/v1/admin/withdrawals/{id}/${action}`].post;
    const params = operation.parameters.map((p) => (p.$ref ? resolve(p.$ref) : p));

    expect(params).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }),
    ]);
    expect(operation.security).toEqual([{ BearerAuth: [] }]);
    expect(resolve(operation.requestBody.$ref).content['application/json'].schema.properties.notes.type).toBe('string');
    expect(Object.keys(operation.responses).sort()).toEqual(statuses);
  });

  it('documents paging and outcomes for the stuck-withdrawals listing', () => {
    const operation = spec.paths['/api/v1/admin/withdrawals/stuck'].get;
    expect(operation.parameters.map((p) => [p.name, p.in])).toEqual([['limit', 'query'], ['offset', 'query']]);
    expect(Object.keys(operation.responses).sort()).toEqual(['200', '401', '403', '500']);
  });
});
