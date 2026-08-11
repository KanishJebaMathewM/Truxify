import { describe, it, expect } from 'vitest';
import mlService from '../../src/services/ml.js';

describe('mlService handleResponse error context', () => {
  it('should include method, url, and status in non-ok error message', async () => {
    const mockResponse = {
      status: 500,
      ok: false,
      json: async () => ({ error: 'Internal Server Error' }),
    };

    let error;
    try {
      await mlService.handleResponse(mockResponse, 'https://api.ml.com/predict', 'POST');
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('POST');
    expect(error.message).toContain('https://api.ml.com/predict');
    expect(error.message).toContain('500');
  });

  it('should include method, url, and status 401 for unauthorized', async () => {
    const mockResponse = {
      status: 401,
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    };

    let error;
    try {
      await mlService.handleResponse(mockResponse, 'https://api.ml.com/embed', 'GET');
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('GET');
    expect(error.message).toContain('https://api.ml.com/embed');
    expect(error.message).toContain('401');
  });

  it('should include method, url, and status 403 for forbidden', async () => {
    const mockResponse = {
      status: 403,
      ok: false,
      json: async () => ({ error: 'Forbidden' }),
    };

    let error;
    try {
      await mlService.handleResponse(mockResponse, 'https://api.ml.com/train', 'PUT');
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('PUT');
    expect(error.message).toContain('https://api.ml.com/train');
    expect(error.message).toContain('403');
  });
});
