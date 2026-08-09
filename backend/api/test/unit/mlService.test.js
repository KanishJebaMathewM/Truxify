import { describe, it, expect } from 'vitest';
import mlService from '../../src/services/ml.js';

describe('ml handleResponse error context', () => {
  it('should include method, url, and status in non-ok error message', async () => {
    const mockResponse = {
      status: 500,
      ok: false,
      json: async () => ({ error: 'Internal Server Error' }),
    };

    await expect(mlService.handleResponse(mockResponse, 'https://api.ml.com/predict', 'POST'))
      .rejects
      .toThrow(/500.*POST.*https:\/\/api\.ml\.com\/predict/);
  });

  it('should include method, url, and status 401 for unauthorized', async () => {
    const mockResponse = {
      status: 401,
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    };

    await expect(mlService.handleResponse(mockResponse, 'https://api.ml.com/embed', 'GET'))
      .rejects
      .toThrow(/401.*GET.*https:\/\/api\.ml\.com\/embed/);
  });

  it('should include method, url, and status 403 for forbidden', async () => {
    const mockResponse = {
      status: 403,
      ok: false,
      json: async () => ({ error: 'Forbidden' }),
    };

    await expect(mlService.handleResponse(mockResponse, 'https://api.ml.com/train', 'PUT'))
      .rejects
      .toThrow(/403.*PUT.*https:\/\/api\.ml\.com\/train/);
  });
});
