import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getRoot, notFound } from '../../src/controllers/rootController.js';

function makeMockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

describe('rootController', () => {
  describe('getRoot', () => {
    it('returns HTML with API status message', () => {
      const req = { hostname: 'localhost' };
      const res = makeMockRes();

      getRoot(req, res);

      expect(res.send).toHaveBeenCalled();
      const html = res.send.mock.calls[0][0];
      expect(html).toContain('Truxify Backend API is running');
      expect(html).toContain('WebSockets');
    });

    it('uses request hostname when available', () => {
      const req = { hostname: 'api.truxify.example.com' };
      const res = makeMockRes();

      getRoot(req, res);

      expect(res.send).toHaveBeenCalled();
      const html = res.send.mock.calls[0][0];
      expect(html).toContain('api.truxify.example.com');
    });
  });

  describe('notFound', () => {
    it('returns 404 with error message', () => {
      const req = {};
      const res = makeMockRes();

      notFound(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Endpoint resource not found.'
      });
    });
  });
});
