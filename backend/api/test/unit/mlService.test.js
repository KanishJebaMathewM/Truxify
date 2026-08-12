import { describe, it, expect } from 'vitest';
import mlService from '../../src/services/ml.js';

describe('mlService handleResponse error context', () => {
  it('should include method, url, and status in non-ok error message', async () => {
    const mockResponse = {
      status: 500,
      ok: false,
      json: async () => ({ error: 'Internal Server Error' }),
    };

    try {
      await mlService.handleResponse(mockResponse, 'https://api.ml.com/predict', 'POST');
    } catch (err) {
      expect(err.message).toContain('POST');
      expect(err.message).toContain('https://api.ml.com/predict');
      expect(err.message).toContain('500');
      return;
    }
    throw new Error('Expected rejection');
  });

  it('should include method, url, and status 401 for unauthorized', async () => {
    const mockResponse = {
      status: 401,
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    };

    try {
      await mlService.handleResponse(mockResponse, 'https://api.ml.com/embed', 'GET');
    } catch (err) {
      expect(err.message).toContain('GET');
      expect(err.message).toContain('https://api.ml.com/embed');
      expect(err.message).toContain('401');
      return;
    }
    throw new Error('Expected rejection');
  });

  it('should include method, url, and status 403 for forbidden', async () => {
    const mockResponse = {
      status: 403,
      ok: false,
      json: async () => ({ error: 'Forbidden' }),
    };

    try {
      await mlService.handleResponse(mockResponse, 'https://api.ml.com/train', 'PUT');
    } catch (err) {
      expect(err.message).toContain('PUT');
      expect(err.message).toContain('https://api.ml.com/train');
      expect(err.message).toContain('403');
      return;
    }
    throw new Error('Expected rejection');
  });
});
