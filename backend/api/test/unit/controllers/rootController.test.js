import { describe, it, expect, vi } from 'vitest';
import { getRoot } from '../../../src/controllers/rootController.js';

describe('rootController', () => {
  it('returns API root HTML string', () => {
    const req = { hostname: 'localhost' };
    const res = {
      send: vi.fn(),
    };

    getRoot(req, res);
    expect(res.send).toHaveBeenCalled();
  });
});
